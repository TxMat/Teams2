"""SFU (Selective Forwarding Unit) for WebRTC media relay."""

import asyncio
import uuid
from typing import Optional

from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from aiortc.contrib.media import MediaRelay


class Participant:
    """Represents a single participant in a meeting."""

    def __init__(self, participant_id: str, name: str):
        self.id = participant_id
        self.name = name
        self.pc: Optional[RTCPeerConnection] = None
        self.tracks: dict[str, MediaStreamTrack] = {}  # kind -> track
        self.relay_tracks: dict[str, MediaStreamTrack] = {}  # For relayed tracks to others

    async def close(self):
        """Close the peer connection and clean up."""
        if self.pc:
            await self.pc.close()
            self.pc = None
        self.tracks.clear()
        self.relay_tracks.clear()


class Meeting:
    """Manages a single meeting room with multiple participants."""

    def __init__(self):
        self.participants: dict[str, Participant] = {}
        self.relay = MediaRelay()
        self._lock = asyncio.Lock()

    async def add_participant(self, name: str) -> Participant:
        """Add a new participant to the meeting."""
        participant_id = str(uuid.uuid4())[:8]
        participant = Participant(participant_id, name)
        
        async with self._lock:
            self.participants[participant_id] = participant
        
        return participant

    async def remove_participant(self, participant_id: str):
        """Remove a participant from the meeting."""
        async with self._lock:
            if participant_id in self.participants:
                participant = self.participants.pop(participant_id)
                await participant.close()

    def get_participant(self, participant_id: str) -> Optional[Participant]:
        """Get a participant by ID."""
        return self.participants.get(participant_id)

    def get_other_participants(self, exclude_id: str) -> list[Participant]:
        """Get all participants except the one with exclude_id."""
        return [p for pid, p in self.participants.items() if pid != exclude_id]

    async def create_peer_connection(self, participant: Participant) -> RTCPeerConnection:
        """Create and configure a peer connection for a participant."""
        pc = RTCPeerConnection()
        participant.pc = pc

        @pc.on("track")
        async def on_track(track: MediaStreamTrack):
            """Handle incoming track from participant."""
            participant.tracks[track.kind] = track

            @track.on("ended")
            async def on_ended():
                if track.kind in participant.tracks:
                    del participant.tracks[track.kind]

        @pc.on("connectionstatechange")
        async def on_connectionstatechange():
            if pc.connectionState in ("failed", "closed", "disconnected"):
                await self.remove_participant(participant.id)

        return pc

    async def handle_offer(
        self, participant: Participant, offer: RTCSessionDescription
    ) -> RTCSessionDescription:
        """Handle an SDP offer from a participant and return an answer."""
        pc = participant.pc
        if not pc:
            pc = await self.create_peer_connection(participant)

        await pc.setRemoteDescription(offer)

        # Add relay tracks from other participants
        for other in self.get_other_participants(participant.id):
            for kind, track in other.tracks.items():
                relay_track = self.relay.subscribe(track)
                pc.addTrack(relay_track)

        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        return pc.localDescription

    async def relay_new_participant_tracks(self, new_participant: Participant):
        """Relay tracks from a new participant to all existing participants."""
        # Wait a bit for tracks to be established
        await asyncio.sleep(0.5)

        for other in self.get_other_participants(new_participant.id):
            if other.pc and other.pc.connectionState == "connected":
                for kind, track in new_participant.tracks.items():
                    relay_track = self.relay.subscribe(track)
                    other.pc.addTrack(relay_track)
                    # Renegotiation will be handled by the signaling layer

    def get_participant_list(self) -> list[dict]:
        """Get a list of all participants for broadcasting."""
        return [
            {"id": p.id, "name": p.name}
            for p in self.participants.values()
        ]


# Global meeting instance (single meeting room)
meeting = Meeting()

