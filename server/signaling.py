"""WebSocket signaling server for WebRTC negotiation."""

import json
import asyncio
import traceback
from typing import Optional

from aiohttp import web, WSMsgType
from aiortc import RTCSessionDescription
from aiortc.sdp import candidate_from_sdp

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
                print(f"Received message type: {msg_type} from {participant.id if participant else 'unknown'}")

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
                    is_initial = participant.pc is None
                    print(f"Received offer from {participant.id}, is_initial={is_initial}")
                    
                    try:
                        offer = RTCSessionDescription(sdp=sdp, type="offer")
                        answer = await meeting.handle_offer(participant, offer)

                        await ws.send_json({
                            "type": "answer",
                            "sdp": answer.sdp,
                        })
                        print(f"Sent answer to {participant.id}")

                        # Only schedule relay for initial offers, not renegotiations
                        if is_initial:
                            asyncio.create_task(
                                relay_tracks_and_renegotiate(participant)
                            )
                    except Exception as e:
                        print(f"Error handling offer from {participant.id}: {e}")
                        traceback.print_exc()

                elif msg_type == "answer" and participant:
                    # Handle SDP answer (from renegotiation)
                    print(f"Received answer from {participant.id}")
                    sdp = data.get("sdp")
                    if participant.pc:
                        try:
                            answer = RTCSessionDescription(sdp=sdp, type="answer")
                            await participant.pc.setRemoteDescription(answer)
                            print(f"Successfully set remote description for {participant.id}")
                        except Exception as e:
                            print(f"Failed to set remote description: {e}")

                elif msg_type == "ice_candidate" and participant:
                    # Handle ICE candidate
                    candidate_data = data.get("candidate")
                    if candidate_data and participant.pc:
                        candidate_str = candidate_data.get("candidate")
                        if candidate_str:
                            try:
                                candidate = candidate_from_sdp(candidate_str)
                                candidate.sdpMid = candidate_data.get("sdpMid")
                                candidate.sdpMLineIndex = candidate_data.get("sdpMLineIndex")
                                await participant.pc.addIceCandidate(candidate)
                            except Exception as e:
                                # ICE candidate may arrive after connection is closed
                                print(f"Failed to add ICE candidate: {e}")

                elif msg_type == "attention_focus" and participant:
                    # Relay attention focus to target participant
                    target_id = data.get("targetId")
                    if target_id:
                        await signaling.send_to(target_id, {
                            "type": "attention_focus",
                            "fromId": participant.id,
                            "fromName": participant.name,
                            "active": data.get("active", False),
                        })

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
    """Notify other participants to renegotiate to receive new tracks."""
    # Wait for tracks to be established - poll until we have them or timeout
    for _ in range(20):  # Wait up to 10 seconds
        await asyncio.sleep(0.5)
        if new_participant.tracks:
            print(f"Tracks received for {new_participant.id}: {list(new_participant.tracks.keys())}")
            break
    else:
        print(f"Timeout waiting for tracks from {new_participant.id}")
        return

    other_participants = meeting.get_other_participants(new_participant.id)
    print(f"Notifying {len(other_participants)} other participants to renegotiate")
    
    for other in other_participants:
        try:
            print(f"Checking {other.id}: pc={other.pc is not None}, state={other.pc.connectionState if other.pc else 'N/A'}")
            if other.pc and other.pc.connectionState == "connected":
                # Tell the client to send a new offer - the server will add new tracks when handling it
                await signaling.send_to(other.id, {
                    "type": "request_offer",
                    "reason": "new_participant",
                })
                print(f"Requested new offer from {other.id}")
        except Exception as e:
            print(f"Failed to request offer from {other.id}: {e}")

