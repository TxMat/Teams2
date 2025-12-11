/**
 * Video Meeting WebRTC Client
 */

/**
 * Voice Activity Detector using Web Audio API
 * Detects when the user is speaking based on audio levels
 */
class VoiceActivityDetector {
    constructor(stream, onSpeakingChange) {
        this.stream = stream;
        this.onSpeakingChange = onSpeakingChange;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.isSpeaking = false;
        this.silenceStart = null;
        this.speakingThreshold = 15; // Audio level threshold (0-255)
        this.silenceDelay = 300; // ms of silence before considered not speaking
        this.animationFrameId = null;
    }

    start() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.stream);
            
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.4;
            
            source.connect(this.analyser);
            
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.detectSpeech();
        } catch (err) {
            console.error('Failed to initialize voice activity detector:', err);
        }
    }

    detectSpeech() {
        if (!this.analyser) return;

        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        const average = sum / this.dataArray.length;

        const nowSpeaking = average > this.speakingThreshold;

        if (nowSpeaking) {
            this.silenceStart = null;
            if (!this.isSpeaking) {
                this.isSpeaking = true;
                this.onSpeakingChange(true);
            }
        } else if (this.isSpeaking) {
            if (!this.silenceStart) {
                this.silenceStart = Date.now();
            } else if (Date.now() - this.silenceStart > this.silenceDelay) {
                this.isSpeaking = false;
                this.onSpeakingChange(false);
            }
        }

        this.animationFrameId = requestAnimationFrame(() => this.detectSpeech());
    }

    stop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}

/**
 * Gaze Tracker using WebGazer.js
 * Tracks where the user is looking on the screen
 */
class GazeTracker {
    constructor() {
        this.isCalibrated = false;
        this.isInitialized = false;
        this.currentGaze = null;
        this.calibrationOverlay = document.getElementById('calibration-overlay');
        this.calibrationPoints = document.querySelectorAll('.calibration-point');
        this.calibrationCurrent = document.getElementById('calibration-current');
        this.calibrationSkipBtn = document.getElementById('calibration-skip');
        this.gazePointer = document.getElementById('gaze-pointer');
        this.currentPointIndex = 0;
        this.clicksPerPoint = 5;
        this.currentClicks = 0;
        this.onCalibrationComplete = null;
        this.showDebugPointer = true; // Enable debug pointer by default
    }

    async init() {
        if (this.isInitialized || typeof webgazer === 'undefined') {
            console.warn('WebGazer not available or already initialized');
            return false;
        }

        try {
            await webgazer
                .setGazeListener((data) => {
                    if (data) {
                        this.currentGaze = { x: data.x, y: data.y };
                        this.updateDebugPointer(data.x, data.y);
                    }
                })
                .saveDataAcrossSessions(true)
                .begin();

            // Hide WebGazer's default UI elements
            webgazer.showVideoPreview(false);
            webgazer.showPredictionPoints(false);
            webgazer.showFaceOverlay(false);
            webgazer.showFaceFeedbackBox(false);

            this.isInitialized = true;
            console.log('WebGazer initialized');
            return true;
        } catch (err) {
            console.error('Failed to initialize WebGazer:', err);
            return false;
        }
    }

    updateDebugPointer(x, y) {
        if (!this.showDebugPointer || !this.gazePointer || !this.isCalibrated) return;
        
        this.gazePointer.style.left = `${x}px`;
        this.gazePointer.style.top = `${y}px`;
    }

    setDebugPointerVisible(visible) {
        this.showDebugPointer = visible;
        if (this.gazePointer) {
            this.gazePointer.classList.toggle('active', visible && this.isCalibrated);
        }
    }

    async calibrate() {
        return new Promise((resolve) => {
            this.onCalibrationComplete = resolve;
            this.currentPointIndex = 0;
            this.currentClicks = 0;
            
            // Reset all points
            this.calibrationPoints.forEach(p => p.classList.remove('clicked', 'active'));
            this.calibrationCurrent.textContent = '1';
            
            // Show first point as active
            this.calibrationPoints[0].classList.add('active');
            
            // Show overlay
            this.calibrationOverlay.classList.add('active');
            
            // Setup point click handlers
            this.calibrationPoints.forEach((point, index) => {
                point.onclick = () => this.handlePointClick(index);
            });
            
            // Setup skip button
            this.calibrationSkipBtn.onclick = () => {
                this.calibrationOverlay.classList.remove('active');
                this.isCalibrated = false;
                resolve(false);
            };
        });
    }

    handlePointClick(index) {
        if (index !== this.currentPointIndex) return;
        
        this.currentClicks++;
        
        // Record calibration data point
        if (typeof webgazer !== 'undefined') {
            const point = this.calibrationPoints[index];
            const rect = point.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            webgazer.recordScreenPosition(x, y);
        }
        
        if (this.currentClicks >= this.clicksPerPoint) {
            // Mark point as completed
            this.calibrationPoints[index].classList.remove('active');
            this.calibrationPoints[index].classList.add('clicked');
            
            // Move to next point
            this.currentPointIndex++;
            this.currentClicks = 0;
            
            if (this.currentPointIndex < this.calibrationPoints.length) {
                this.calibrationCurrent.textContent = (this.currentPointIndex + 1).toString();
                this.calibrationPoints[this.currentPointIndex].classList.add('active');
            } else {
                // Calibration complete
                this.calibrationOverlay.classList.remove('active');
                this.isCalibrated = true;
                
                // Show debug pointer after calibration
                if (this.gazePointer && this.showDebugPointer) {
                    this.gazePointer.classList.add('active');
                }
                
                if (this.onCalibrationComplete) {
                    this.onCalibrationComplete(true);
                }
            }
        }
    }

    getGazeTarget(videoContainers) {
        if (!this.currentGaze || !this.isCalibrated) return null;

        for (const [participantId, container] of videoContainers) {
            const rect = container.getBoundingClientRect();
            if (
                this.currentGaze.x >= rect.left &&
                this.currentGaze.x <= rect.right &&
                this.currentGaze.y >= rect.top &&
                this.currentGaze.y <= rect.bottom
            ) {
                return participantId;
            }
        }
        return null;
    }

    stop() {
        if (typeof webgazer !== 'undefined' && this.isInitialized) {
            webgazer.end();
            this.isInitialized = false;
        }
        // Hide debug pointer
        if (this.gazePointer) {
            this.gazePointer.classList.remove('active');
        }
        this.isCalibrated = false;
    }
}

/**
 * Attention Tracker
 * Combines voice activity and gaze tracking to detect when user is 
 * addressing a specific participant (speaking while looking at them)
 */
class AttentionTracker {
    constructor(sendAttentionFocus) {
        this.sendAttentionFocus = sendAttentionFocus;
        this.voiceDetector = null;
        this.gazeTracker = null;
        this.isSpeaking = false;
        this.currentGazeTarget = null;
        this.gazeTargetStartTime = null;
        this.activeAttentionTarget = null;
        this.attentionThreshold = 0; // 2 seconds
        this.checkInterval = null;
        this.videoContainers = new Map(); // participantId -> DOM element
        this.localParticipantId = null;
    }

    async init(stream, localParticipantId) {
        this.localParticipantId = localParticipantId;
        
        // Initialize voice detector
        this.voiceDetector = new VoiceActivityDetector(stream, (speaking) => {
            this.isSpeaking = speaking;
            if (!speaking) {
                this.clearAttention();
            }
        });
        this.voiceDetector.start();

        // Initialize gaze tracker
        this.gazeTracker = new GazeTracker();
        await this.gazeTracker.init();

        // Start checking attention
        this.checkInterval = setInterval(() => this.checkAttention(), 100);
    }

    async calibrate() {
        if (!this.gazeTracker) return false;
        const result = await this.gazeTracker.calibrate();
        return result;
    }

    isGazeCalibrated() {
        return this.gazeTracker?.isCalibrated ?? false;
    }

    updateVideoContainers() {
        this.videoContainers.clear();
        const containers = document.querySelectorAll('.video-container');
        containers.forEach(container => {
            const id = container.id.replace('video-', '');
            if (id !== this.localParticipantId) {
                this.videoContainers.set(id, container);
            }
        });
    }

    checkAttention() {
        if (!this.gazeTracker?.isCalibrated) return;

        this.updateVideoContainers();
        const gazeTarget = this.gazeTracker.getGazeTarget(this.videoContainers);

        // Update gaze target tracking
        if (gazeTarget !== this.currentGazeTarget) {
            this.currentGazeTarget = gazeTarget;
            this.gazeTargetStartTime = gazeTarget ? Date.now() : null;
            
            // If we were focusing on someone else, clear that attention
            if (this.activeAttentionTarget && this.activeAttentionTarget !== gazeTarget) {
                this.sendAttentionFocus(this.activeAttentionTarget, false);
                this.activeAttentionTarget = null;
            }
        }

        // Check if we should trigger attention
        if (
            // this.isSpeaking && does not work for now (todo : fix later)
            this.currentGazeTarget &&
            this.gazeTargetStartTime &&
            Date.now() - this.gazeTargetStartTime >= this.attentionThreshold
        ) {
            if (this.activeAttentionTarget !== this.currentGazeTarget) {
                // Clear previous target if any
                if (this.activeAttentionTarget) {
                    this.sendAttentionFocus(this.activeAttentionTarget, false);
                }
                // Set new target
                this.activeAttentionTarget = this.currentGazeTarget;
                this.sendAttentionFocus(this.activeAttentionTarget, true);
            }
        }
    }

    clearAttention() {
        if (this.activeAttentionTarget) {
            this.sendAttentionFocus(this.activeAttentionTarget, false);
            this.activeAttentionTarget = null;
        }
        this.gazeTargetStartTime = null;
    }

    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        if (this.voiceDetector) {
            this.voiceDetector.stop();
        }
        if (this.gazeTracker) {
            this.gazeTracker.stop();
        }
        this.clearAttention();
    }
}

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
        this.attentionTracker = null;
        this.attentionHighlightActive = false;

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
        this.calibrateGazeBtn = document.getElementById('calibrate-gaze');
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
        this.calibrateGazeBtn.addEventListener('click', () => this.calibrateGaze());
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

            case 'attention_focus':
                // Someone is talking while looking at us
                this.setAttentionHighlight(data.active, data.fromName);
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

        // Initialize attention tracker
        this.initAttentionTracker();
    }

    async initAttentionTracker() {
        this.attentionTracker = new AttentionTracker((targetId, active) => {
            this.sendAttentionFocus(targetId, active);
        });
        await this.attentionTracker.init(this.localStream, this.participantId);
    }

    async calibrateGaze() {
        if (!this.attentionTracker) {
            this.showToast('Join a meeting first to calibrate', 'error');
            return;
        }

        this.showToast('Starting eye tracking calibration...', 'success');
        const success = await this.attentionTracker.calibrate();
        
        if (success) {
            this.calibrateGazeBtn.classList.add('calibrated');
            this.showToast('Eye tracking calibrated!', 'success');
        } else {
            this.showToast('Calibration skipped', '');
        }
    }

    sendAttentionFocus(targetId, active) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'attention_focus',
                targetId,
                active
            }));
        }
    }

    setAttentionHighlight(active, fromName) {
        const localContainer = document.getElementById(`video-${this.participantId}`);
        if (!localContainer) return;

        if (active && !this.attentionHighlightActive) {
            localContainer.classList.add('attention-highlight');
            this.attentionHighlightActive = true;
            if (fromName) {
                this.showToast(`${fromName} is talking to you`, 'success');
            }
        } else if (!active && this.attentionHighlightActive) {
            localContainer.classList.remove('attention-highlight');
            this.attentionHighlightActive = false;
        }
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
        // Clean up attention tracker
        if (this.attentionTracker) {
            this.attentionTracker.stop();
            this.attentionTracker = null;
        }
        this.attentionHighlightActive = false;
        this.calibrateGazeBtn.classList.remove('calibrated');

        // Clean up timer
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


