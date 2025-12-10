/**
 * Video Meeting WebRTC Client
 */

class MeetingClient {
    constructor() {
        // State
        this.participantId = null;
        this.participantName = '';
        this.localStream = null;
        this.peerConnection = null;
        this.ws = null;
        this.isMicMuted = false;
        this.isCameraMuted = false;
        this.participants = new Map(); // id -> {name, stream}
        this.meetingStartTime = null;
        this.timerInterval = null;

        // DOM Elements
        this.joinScreen = document.getElementById('join-screen');
        this.meetingScreen = document.getElementById('meeting-screen');
        this.nameInput = document.getElementById('name-input');
        this.joinBtn = document.getElementById('join-btn');
        this.previewVideo = document.getElementById('preview-video');
        this.previewStatus = document.getElementById('preview-status');
        this.videoGrid = document.getElementById('video-grid');
        this.toggleMicBtn = document.getElementById('toggle-mic');
        this.toggleCameraBtn = document.getElementById('toggle-camera');
        this.leaveBtn = document.getElementById('leave-btn');
        this.participantCountText = document.getElementById('participant-count-text');
        this.meetingTimer = document.getElementById('meeting-timer');
        this.toastContainer = document.getElementById('toast-container');

        this.init();
    }

    async init() {
        // Setup event listeners
        this.joinBtn.addEventListener('click', () => this.joinMeeting());
        this.nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinMeeting();
        });
        this.toggleMicBtn.addEventListener('click', () => this.toggleMic());
        this.toggleCameraBtn.addEventListener('click', () => this.toggleCamera());
        this.leaveBtn.addEventListener('click', () => this.leaveMeeting());

        // Start camera preview
        await this.startPreview();
    }

    async startPreview() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720, facingMode: 'user' },
                audio: true
            });
            this.previewVideo.srcObject = this.localStream;
            this.previewStatus.textContent = 'Camera ready';
        } catch (err) {
            console.error('Failed to get media:', err);
            this.previewStatus.textContent = 'Camera unavailable';
            this.showToast('Could not access camera/microphone', 'error');
        }
    }

    async joinMeeting() {
        const name = this.nameInput.value.trim() || 'Anonymous';
        this.participantName = name;

        if (!this.localStream) {
            this.showToast('Please allow camera access first', 'error');
            return;
        }

        this.joinBtn.disabled = true;
        this.joinBtn.querySelector('span').textContent = 'Connecting...';

        try {
            // Connect WebSocket
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
            
            this.ws.onopen = () => {
                this.ws.send(JSON.stringify({ type: 'join', name }));
            };

            this.ws.onmessage = (event) => this.handleSignalingMessage(JSON.parse(event.data));
            
            this.ws.onerror = (err) => {
                console.error('WebSocket error:', err);
                this.showToast('Connection error', 'error');
                this.resetJoinButton();
            };

            this.ws.onclose = () => {
                if (this.meetingScreen.classList.contains('active')) {
                    this.showToast('Disconnected from server', 'error');
                    this.leaveMeeting();
                }
            };
        } catch (err) {
            console.error('Failed to join:', err);
            this.showToast('Failed to join meeting', 'error');
            this.resetJoinButton();
        }
    }

    resetJoinButton() {
        this.joinBtn.disabled = false;
        this.joinBtn.querySelector('span').textContent = 'Join Now';
    }

    async handleSignalingMessage(data) {
        switch (data.type) {
            case 'joined':
                this.participantId = data.participantId;
                data.participants.forEach(p => {
                    if (p.id !== this.participantId) {
                        this.participants.set(p.id, { name: p.name, stream: null });
                    }
                });
                await this.setupPeerConnection();
                this.showMeetingScreen();
                break;

            case 'participant_joined':
                this.participants.set(data.participant.id, { 
                    name: data.participant.name, 
                    stream: null 
                });
                this.updateParticipantCount();
                this.showToast(`${data.participant.name} joined`);
                break;

            case 'participant_left':
                const leaving = this.participants.get(data.participantId);
                if (leaving) {
                    this.showToast(`${leaving.name} left`);
                    this.participants.delete(data.participantId);
                    this.removeVideoElement(data.participantId);
                    this.updateParticipantCount();
                }
                break;

            case 'answer':
                if (this.peerConnection) {
                    await this.peerConnection.setRemoteDescription({
                        type: 'answer',
                        sdp: data.sdp
                    });
                }
                break;

            case 'renegotiate':
                // Server is sending a new offer for renegotiation (legacy)
                console.log('Received renegotiate offer from server');
                if (this.peerConnection) {
                    try {
                        await this.peerConnection.setRemoteDescription({
                            type: 'offer',
                            sdp: data.sdp
                        });
                        console.log('Set remote description for renegotiation');
                        const answer = await this.peerConnection.createAnswer();
                        await this.peerConnection.setLocalDescription(answer);
                        console.log('Created and set local answer, sending to server');
                        this.ws.send(JSON.stringify({
                            type: 'answer',
                            sdp: answer.sdp
                        }));
                    } catch (err) {
                        console.error('Renegotiation failed:', err);
                    }
                }
                break;

            case 'request_offer':
                // Server is asking us to send a new offer (to receive new tracks)
                console.log('Server requested new offer:', data.reason);
                console.log('Current signaling state:', this.peerConnection?.signalingState);
                console.log('Current connection state:', this.peerConnection?.connectionState);
                
                if (this.peerConnection && this.peerConnection.signalingState === 'stable') {
                    try {
                        // Small delay to ensure previous operations completed
                        await new Promise(r => setTimeout(r, 100));
                        
                        console.log('Creating new offer...');
                        const offer = await this.peerConnection.createOffer();
                        console.log('Setting local description...');
                        await this.peerConnection.setLocalDescription(offer);
                        console.log('Sending offer to server...');
                        this.ws.send(JSON.stringify({
                            type: 'offer',
                            sdp: offer.sdp
                        }));
                        console.log('Renegotiation offer sent successfully');
                    } catch (err) {
                        console.error('Failed to create renegotiation offer:', err);
                    }
                } else {
                    console.warn('Cannot renegotiate: PC state is', this.peerConnection?.signalingState);
                }
                break;
        }
    }

    async setupPeerConnection() {
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.peerConnection = new RTCPeerConnection(config);

        // Add local tracks
        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });

        // Handle incoming tracks
        // Track assignment by participant - audio and video may arrive with different stream IDs
        this.peerConnection.ontrack = (event) => {
            const track = event.track;
            console.log('Received track:', track.kind);
            
            // Find a participant who needs this type of track
            let assignedId = null;
            for (const [id, participant] of this.participants) {
                // Check if this participant needs a track of this kind
                const hasTrackOfKind = participant.stream?.getTracks().some(t => t.kind === track.kind);
                if (!hasTrackOfKind) {
                    assignedId = id;
                    
                    if (!participant.stream) {
                        // Create new stream for this participant
                        participant.stream = new MediaStream();
                        this.addVideoElement(id, participant.name, participant.stream, false);
                    }
                    
                    // Add track to participant's stream
                    participant.stream.addTrack(track);
                    
                    // Update video element if it exists
                    const videoEl = document.querySelector(`#video-${id} video`);
                    if (videoEl) {
                        videoEl.srcObject = participant.stream;
                    }
                    break;
                }
            }
            
            // If no participant found, create generic remote
            if (!assignedId) {
                assignedId = 'remote_' + Date.now();
                const stream = new MediaStream([track]);
                this.addVideoElement(assignedId, 'Participant', stream, false);
            }
        };

        // ICE candidate handling
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'ice_candidate',
                    candidate: {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex
                    }
                }));
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
        };

        // Create and send offer
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);

        this.ws.send(JSON.stringify({
            type: 'offer',
            sdp: offer.sdp
        }));
    }

    showMeetingScreen() {
        this.joinScreen.classList.remove('active');
        this.meetingScreen.classList.add('active');

        // Add local video
        this.addVideoElement(this.participantId, this.participantName + ' (You)', this.localStream, true);
        
        // Start timer
        this.meetingStartTime = Date.now();
        this.timerInterval = setInterval(() => this.updateTimer(), 1000);
        
        this.updateParticipantCount();
        this.showToast('You joined the meeting', 'success');
    }

    addVideoElement(id, name, stream, isLocal) {
        // Check if element already exists
        if (document.getElementById(`video-${id}`)) {
            const existingVideo = document.querySelector(`#video-${id} video`);
            if (existingVideo && stream) {
                existingVideo.srcObject = stream;
            }
            return;
        }

        const container = document.createElement('div');
        container.id = `video-${id}`;
        container.className = `video-container${isLocal ? ' local' : ''}`;

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        if (isLocal) video.muted = true;
        if (stream) video.srcObject = stream;

        const overlay = document.createElement('div');
        overlay.className = 'video-overlay';
        overlay.innerHTML = `
            <span class="participant-name">${this.escapeHtml(name)}</span>
            <div class="mute-indicator">
                <svg class="mic-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                </svg>
            </div>
        `;

        container.appendChild(video);
        container.appendChild(overlay);
        this.videoGrid.appendChild(container);

        this.updateGridLayout();
    }

    removeVideoElement(id) {
        const element = document.getElementById(`video-${id}`);
        if (element) {
            element.remove();
            this.updateGridLayout();
        }
    }

    updateGridLayout() {
        const count = this.videoGrid.children.length;
        this.videoGrid.classList.toggle('single', count === 1);
    }

    updateParticipantCount() {
        const count = this.participants.size + 1; // +1 for self
        this.participantCountText.textContent = count;
    }

    updateTimer() {
        if (!this.meetingStartTime) return;
        const elapsed = Math.floor((Date.now() - this.meetingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        this.meetingTimer.textContent = `${minutes}:${seconds}`;
    }

    toggleMic() {
        if (!this.localStream) return;
        
        this.isMicMuted = !this.isMicMuted;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMicMuted;
        });
        
        this.toggleMicBtn.classList.toggle('active', this.isMicMuted);
        
        // Update local video mute indicator
        const localContainer = document.getElementById(`video-${this.participantId}`);
        if (localContainer) {
            const micIcon = localContainer.querySelector('.mic-muted');
            if (micIcon) micIcon.classList.toggle('active', this.isMicMuted);
        }
    }

    toggleCamera() {
        if (!this.localStream) return;
        
        this.isCameraMuted = !this.isCameraMuted;
        this.localStream.getVideoTracks().forEach(track => {
            track.enabled = !this.isCameraMuted;
        });
        
        this.toggleCameraBtn.classList.toggle('active', this.isCameraMuted);
    }

    leaveMeeting() {
        // Clean up
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'leave' }));
            this.ws.close();
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // Clear video grid
        this.videoGrid.innerHTML = '';
        this.participants.clear();

        // Reset UI
        this.meetingScreen.classList.remove('active');
        this.joinScreen.classList.add('active');
        this.resetJoinButton();
        this.meetingTimer.textContent = '00:00';
        
        // Restart preview
        if (this.localStream) {
            this.previewVideo.srcObject = this.localStream;
        }
    }

    showToast(message, type = '') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        this.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    window.meetingClient = new MeetingClient();
});


