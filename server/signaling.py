"""WebSocket signaling server for WebRTC negotiation."""

import json
import asyncio
from typing import Optional

from aiohttp import web, WSMsgType
from aiortc import RTCSessionDescription, RTCIceCandidate

from .sfu import meeting, Participant


class SignalingHandler:
    """Handles WebSocket signaling for WebRTC connections."""

    def __init__(self):
        self.websockets: dict[str, web.WebSocketResponse] = {}  # participant_id -> ws
        self._lock = asyncio.Lock()

    async def register(self, participant_id: str, ws: web.WebSocketResponse):
        """Register a WebSocket connection for a participant."""
        async with self._lock:
            self.websockets[participant_id] = ws

    async def unregister(self, participant_id: str):
        """Unregister a WebSocket connection."""
        async with self._lock:
            self.websockets.pop(participant_id, None)

    async def send_to(self, participant_id: str, message: dict):
        """Send a message to a specific participant."""
        ws = self.websockets.get(participant_id)
        if ws and not ws.closed:
            await ws.send_json(message)

    async def broadcast(self, message: dict, exclude_id: Optional[str] = None):
        """Broadcast a message to all participants except exclude_id."""
        async with self._lock:
            for pid, ws in self.websockets.items():
                if pid != exclude_id and not ws.closed:
                    await ws.send_json(message)


# Global signaling handler
signaling = SignalingHandler()


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    """Handle WebSocket connections for signaling."""
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    participant: Optional[Participant] = None

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                data = json.loads(msg.data)
                msg_type = data.get("type")

                if msg_type == "join":
                    # New participant joining
                    name = data.get("name", "Anonymous")
                    participant = await meeting.add_participant(name)
                    await signaling.register(participant.id, ws)

                    # Send back participant ID and existing participants
                    await ws.send_json({
                        "type": "joined",
                        "participantId": participant.id,
                        "participants": meeting.get_participant_list(),
                    })

                    # Broadcast to others that someone joined
                    await signaling.broadcast({
                        "type": "participant_joined",
                        "participant": {"id": participant.id, "name": name},
                    }, exclude_id=participant.id)

                elif msg_type == "offer" and participant:
                    # Handle SDP offer
                    sdp = data.get("sdp")
                    offer = RTCSessionDescription(sdp=sdp, type="offer")
                    answer = await meeting.handle_offer(participant, offer)

                    await ws.send_json({
                        "type": "answer",
                        "sdp": answer.sdp,
                    })

                    # Schedule relay of new participant's tracks to others
                    asyncio.create_task(
                        relay_tracks_and_renegotiate(participant)
                    )

                elif msg_type == "ice_candidate" and participant:
                    # Handle ICE candidate
                    candidate_data = data.get("candidate")
                    if candidate_data and participant.pc:
                        candidate = RTCIceCandidate(
                            sdpMid=candidate_data.get("sdpMid"),
                            sdpMLineIndex=candidate_data.get("sdpMLineIndex"),
                            candidate=candidate_data.get("candidate"),
                        )
                        await participant.pc.addIceCandidate(candidate)

                elif msg_type == "leave" and participant:
                    break

            elif msg.type == WSMsgType.ERROR:
                break

    finally:
        # Clean up when WebSocket closes
        if participant:
            await signaling.unregister(participant.id)
            await meeting.remove_participant(participant.id)
            
            # Broadcast that participant left
            await signaling.broadcast({
                "type": "participant_left",
                "participantId": participant.id,
            })

    return ws


async def relay_tracks_and_renegotiate(new_participant: Participant):
    """Relay new participant's tracks to others and trigger renegotiation."""
    # Wait for tracks to be established
    await asyncio.sleep(1.0)

    if not new_participant.tracks:
        return

    for other in meeting.get_other_participants(new_participant.id):
        if other.pc and other.pc.connectionState == "connected":
            # Add relay tracks from new participant
            for kind, track in new_participant.tracks.items():
                relay_track = meeting.relay.subscribe(track)
                other.pc.addTrack(relay_track)

            # Create new offer for renegotiation
            offer = await other.pc.createOffer()
            await other.pc.setLocalDescription(offer)

            # Send renegotiation offer to the other participant
            await signaling.send_to(other.id, {
                "type": "renegotiate",
                "sdp": other.pc.localDescription.sdp,
            })

