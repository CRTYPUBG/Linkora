import { LinkoraCrypto } from "@linkora/crypto";

export interface PeerConnectionContext {
  peerId: string;
  connection: RTCPeerConnection;
  audioSender?: RTCRtpSender;
  screenSender?: RTCRtpSender;
  remoteAudioStream?: MediaStream;
  remoteScreenStream?: MediaStream;
  iceCandidateQueue: RTCIceCandidateInit[];
}

export type WebRtcStats = {
  rttMs: number;
  packetsLost: number;
  jitterMs: number;
  candidateType: string;
  bytesReceived: number;
  bytesSent: number;
};

export class WebRtcManager {
  private peers = new Map<string, PeerConnectionContext>();
  private localAudioStream: MediaStream | null = null;
  private localScreenStream: MediaStream | null = null;
  private currentScreenFps: 15 | 30 | 60 = 30;
  private iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  private crypto: LinkoraCrypto | null = null;
  private e2eeEnabled: boolean = false;

  public onRemoteStream?: (peerId: string, stream: MediaStream, type: "audio" | "screen") => void;
  public onPeerDisconnected?: (peerId: string) => void;
  public onSendSignal?: (targetPeerId: string, signal: any) => void;
  public onDiagnosticsUpdate?: (peerId: string, message: string) => void;

  constructor() {}

  public setIceServers(servers: RTCIceServer[]) {
    this.iceServers = servers;
  }

  public async setCryptoSecret(secret: string, roomCode: string): Promise<string> {
    this.crypto = new LinkoraCrypto();
    await this.crypto.initializeFromSecret(secret, roomCode);
    this.e2eeEnabled = true;
    return await this.crypto.getVerificationFingerprint();
  }

  public getCrypto(): LinkoraCrypto | null {
    return this.crypto;
  }

  /**
   * Acquire local microphone audio with Opus-optimized constraints
   */
  public async startMicrophone(deviceId?: string): Promise<MediaStream> {
    if (this.localAudioStream) {
      this.stopMicrophone();
    }

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 2,
      sampleRate: 48000,
      sampleSize: 16,
    };

    if (deviceId) {
      audioConstraints.deviceId = { exact: deviceId };
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    });

    this.localAudioStream = stream;

    // Attach to existing peer connections
    const audioTrack = stream.getAudioTracks()[0];
    for (const [_, ctx] of this.peers) {
      if (ctx.audioSender) {
        ctx.audioSender.replaceTrack(audioTrack);
      } else {
        ctx.audioSender = ctx.connection.addTrack(audioTrack, stream);
      }
    }

    return stream;
  }

  public stopMicrophone() {
    if (this.localAudioStream) {
      this.localAudioStream.getTracks().forEach((t) => t.stop());
      this.localAudioStream = null;
    }
  }

  public setMicrophoneMute(muted: boolean) {
    if (this.localAudioStream) {
      this.localAudioStream.getAudioTracks().forEach((t) => {
        t.enabled = !muted;
      });
    }
  }

  /**
   * Screen capture with frame-rate presets (15, 30, 60 FPS) and 1080p target.
   * Also applies RTCRtpSender encoding parameters (maxBitrate & maxFramerate)
   * to enforce actual bandwidth and frame rate at the WebRTC encoder layer.
   */
  public async startScreenShare(fps: 15 | 30 | 60 = 30): Promise<MediaStream> {
    if (this.localScreenStream) {
      this.stopScreenShare();
    }

    this.currentScreenFps = fps;

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { max: 1920, ideal: 1920 },
        height: { max: 1080, ideal: 1080 },
        frameRate: { ideal: fps, max: fps },
      },
      audio: true, // System audio sharing if supported
    });

    this.localScreenStream = stream;

    const videoTrack = stream.getVideoTracks()[0];
    videoTrack.onended = () => {
      this.stopScreenShare();
    };

    // Attach to peer connections and configure actual sender encoder parameters
    for (const [_, ctx] of this.peers) {
      if (ctx.screenSender) {
        ctx.screenSender.replaceTrack(videoTrack);
      } else {
        ctx.screenSender = ctx.connection.addTrack(videoTrack, stream);
      }
      this.applyScreenEncodingParameters(ctx.screenSender, fps);
    }

    return stream;
  }

  /**
   * Dynamically adjust encoder bitrate and framerate caps
   */
  public async setScreenFps(fps: 15 | 30 | 60) {
    this.currentScreenFps = fps;
    if (this.localScreenStream) {
      const videoTrack = this.localScreenStream.getVideoTracks()[0];
      if (videoTrack) {
        try {
          await videoTrack.applyConstraints({
            frameRate: { ideal: fps, max: fps },
          });
        } catch (e) {
          console.warn("Could not apply frameRate track constraint:", e);
        }
      }
    }

    for (const [_, ctx] of this.peers) {
      if (ctx.screenSender) {
        this.applyScreenEncodingParameters(ctx.screenSender, fps);
      }
    }
  }

  private applyScreenEncodingParameters(sender: RTCRtpSender, fps: 15 | 30 | 60) {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      // Bitrate policy: 60fps -> 4.5Mbps, 30fps -> 2.5Mbps, 15fps -> 1.0Mbps
      const bitrateMap = {
        60: 4500000,
        30: 2500000,
        15: 1000000,
      };
      params.encodings[0].maxBitrate = bitrateMap[fps];
      params.encodings[0].maxFramerate = fps;
      sender.setParameters(params).catch((err) => {
        console.warn("Failed to set sender encoding parameters:", err);
      });
    } catch (e) {
      console.warn("Could not inspect sender parameters:", e);
    }
  }

  public stopScreenShare() {
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
    }
    for (const [_, ctx] of this.peers) {
      if (ctx.screenSender) {
        try {
          ctx.connection.removeTrack(ctx.screenSender);
        } catch (e) {}
        ctx.screenSender = undefined;
      }
    }
  }

  public getOrCreatePeerConnection(peerId: string, isInitiator: boolean): RTCPeerConnection {
    const existing = this.peers.get(peerId);
    if (existing) {
      return existing.connection;
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
    });

    const ctx: PeerConnectionContext = {
      peerId,
      connection: pc,
      iceCandidateQueue: [],
    };
    this.peers.set(peerId, ctx);

    // Add local tracks if available
    if (this.localAudioStream) {
      const audioTrack = this.localAudioStream.getAudioTracks()[0];
      if (audioTrack) {
        ctx.audioSender = pc.addTrack(audioTrack, this.localAudioStream);
      }
    }

    if (this.localScreenStream) {
      const videoTrack = this.localScreenStream.getVideoTracks()[0];
      if (videoTrack) {
        ctx.screenSender = pc.addTrack(videoTrack, this.localScreenStream);
        this.applyScreenEncodingParameters(ctx.screenSender, this.currentScreenFps);
      }
    }

    // ICE Candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate && this.onSendSignal) {
        this.onSendSignal(peerId, {
          signalType: "candidate",
          candidate: event.candidate.toJSON(),
          mediaType: "audio",
        });
      }
    };

    // Track received handler
    pc.ontrack = (event) => {
      const track = event.track;
      const stream = event.streams[0] || new MediaStream([track]);

      if (track.kind === "audio") {
        ctx.remoteAudioStream = stream;
        this.onRemoteStream?.(peerId, stream, "audio");
      } else if (track.kind === "video") {
        ctx.remoteScreenStream = stream;
        this.onRemoteStream?.(peerId, stream, "screen");
      }
    };

    pc.oniceconnectionstatechange = () => {
      this.onDiagnosticsUpdate?.(peerId, `ICE State: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === "failed") {
        // Trigger ICE Restart if connection drops
        this.restartIce(peerId);
      }
    };

    pc.onconnectionstatechange = () => {
      this.onDiagnosticsUpdate?.(peerId, `Peer State: ${pc.connectionState}`);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.onPeerDisconnected?.(peerId);
      }
    };

    // Negotiation handler for initiator
    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.onSendSignal?.(peerId, {
            signalType: "offer",
            sdp: pc.localDescription?.sdp,
            mediaType: "audio",
          });
        } catch (e) {
          console.error("Negotiation error:", e);
        }
      };
    }

    return pc;
  }

  public async restartIce(peerId: string) {
    const ctx = this.peers.get(peerId);
    if (!ctx) return;
    try {
      this.onDiagnosticsUpdate?.(peerId, "Attempting ICE restart...");
      const offer = await ctx.connection.createOffer({ iceRestart: true });
      await ctx.connection.setLocalDescription(offer);
      this.onSendSignal?.(peerId, {
        signalType: "offer",
        sdp: ctx.connection.localDescription?.sdp,
        mediaType: "audio",
      });
    } catch (e) {
      console.warn("ICE restart failed:", e);
    }
  }

  public async handleSignal(senderPeerId: string, signal: any) {
    const pc = this.getOrCreatePeerConnection(senderPeerId, false);
    const ctx = this.peers.get(senderPeerId)!;

    if (signal.signalType === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp }));

      // Drain queued ICE candidates
      while (ctx.iceCandidateQueue.length > 0) {
        const candidate = ctx.iceCandidateQueue.shift();
        if (candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn("Error adding queued ICE candidate:", e);
          }
        }
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.onSendSignal?.(senderPeerId, {
        signalType: "answer",
        sdp: pc.localDescription?.sdp,
        mediaType: signal.mediaType || "audio",
      });
    } else if (signal.signalType === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp }));

      // Drain queued ICE candidates
      while (ctx.iceCandidateQueue.length > 0) {
        const candidate = ctx.iceCandidateQueue.shift();
        if (candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn("Error adding queued ICE candidate:", e);
          }
        }
      }
    } else if (signal.signalType === "candidate") {
      const candidateInit = signal.candidate;
      if (!candidateInit) return;

      if (!pc.remoteDescription || !pc.remoteDescription.type) {
        // Remote description not yet set, queue candidate
        ctx.iceCandidateQueue.push(candidateInit);
      } else {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
        } catch (err) {
          console.warn("Could not add ice candidate:", err);
        }
      }
    }
  }

  public async getPeerStats(peerId: string): Promise<WebRtcStats | null> {
    const ctx = this.peers.get(peerId);
    if (!ctx) return null;

    try {
      const stats = await ctx.connection.getStats();
      let rtt = 0;
      let packetsLost = 0;
      let jitter = 0;
      let candidateType = "direct-p2p";
      let bytesRecv = 0;
      let bytesSent = 0;

      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          rtt = (report.currentRoundTripTime || 0) * 1000;
        }
        if (report.type === "inbound-rtp") {
          packetsLost = report.packetsLost || 0;
          jitter = (report.jitter || 0) * 1000;
          bytesRecv = report.bytesReceived || 0;
        }
        if (report.type === "outbound-rtp") {
          bytesSent = report.bytesSent || 0;
        }
        if (report.type === "remote-candidate") {
          candidateType = report.candidateType || "direct-p2p";
        }
      });

      return {
        rttMs: Math.round(rtt),
        packetsLost,
        jitterMs: Math.round(jitter),
        candidateType,
        bytesReceived: bytesRecv,
        bytesSent: bytesSent,
      };
    } catch (e) {
      return null;
    }
  }

  public removePeer(peerId: string) {
    const ctx = this.peers.get(peerId);
    if (ctx) {
      ctx.connection.close();
      this.peers.delete(peerId);
    }
  }

  public closeAll() {
    this.stopMicrophone();
    this.stopScreenShare();
    for (const [_, ctx] of this.peers) {
      ctx.connection.close();
    }
    this.peers.clear();
  }
}
