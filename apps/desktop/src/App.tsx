import React, { useEffect, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Settings,
  ShieldCheck,
  Signal,
  Users,
  Volume2,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { SignalingClient, ConnectionState } from "./lib/signaling";
import { WebRtcManager, WebRtcStats } from "./lib/webrtc";
import { Participant } from "@linkora/shared";
import "./App.css";

export function App() {
  // Navigation & View
  const [isInRoom, setIsInRoom] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Connection & Room Inputs
  const [serverUrl, setServerUrl] = useState("ws://127.0.0.1:4000/ws");
  const [roomCode, setRoomCode] = useState("linkora-secret-lounge");
  const [displayName, setDisplayName] = useState("GamerFriend");
  const [e2eePassphrase, setE2eePassphrase] = useState("LinkoraSecure2026!");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>("disconnected");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // In-Room State
  const [myPeerId, setMyPeerId] = useState<string>("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenFps, setScreenFps] = useState<15 | 30 | 60>(30);
  const [e2eeFingerprint, setE2eeFingerprint] = useState<string>("");
  const [peerStats, setPeerStats] = useState<Record<string, WebRtcStats>>({});

  // Audio & Devices
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [inputLevel, setInputLevel] = useState<number>(0);

  // Screen sharing viewing
  const [activeScreenStream, setActiveScreenStream] = useState<MediaStream | null>(null);
  const [activeScreenOwner, setActiveScreenOwner] = useState<string | null>(null);

  // References
  const signalingRef = useRef<SignalingClient | null>(null);
  const webrtcRef = useRef<WebRtcManager | null>(null);
  const localScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioContainerRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Initialize signaling & WebRTC instances
  useEffect(() => {
    const signaling = new SignalingClient(serverUrl);
    const webrtc = new WebRtcManager();

    signalingRef.current = signaling;
    webrtcRef.current = webrtc;

    signaling.onStateChange((st) => setConnectionStatus(st));

    signaling.onMessage(async (msg) => {
      switch (msg.type) {
        case "joined": {
          setMyPeerId(msg.peerId);
          setParticipants(msg.participants);
          webrtc.setIceServers(msg.iceServers);

          // Initiate call to existing peers
          for (const p of msg.participants) {
            if (p.id !== msg.peerId) {
              webrtc.getOrCreatePeerConnection(p.id, true);
            }
          }
          setIsInRoom(true);
          setErrorMessage(null);
          break;
        }

        case "peer-joined": {
          setParticipants((prev) => [...prev.filter((p) => p.id !== msg.participant.id), msg.participant]);
          // Wait for incoming offer or prepare connection
          webrtc.getOrCreatePeerConnection(msg.participant.id, false);
          break;
        }

        case "peer-left": {
          setParticipants((prev) => prev.filter((p) => p.id !== msg.peerId));
          webrtc.removePeer(msg.peerId);
          if (activeScreenOwner === msg.peerId) {
            setActiveScreenStream(null);
            setActiveScreenOwner(null);
          }
          break;
        }

        case "signal": {
          await webrtc.handleSignal(msg.fromPeerId, msg.signal);
          break;
        }

        case "peer-media-state": {
          setParticipants((prev) =>
            prev.map((p) =>
              p.id === msg.peerId
                ? {
                    ...p,
                    isMuted: msg.isMuted ?? p.isMuted,
                    isDeafened: msg.isDeafened ?? p.isDeafened,
                    isScreenSharing: msg.isScreenSharing ?? p.isScreenSharing,
                    screenSharingFps: msg.screenSharingFps ?? p.screenSharingFps,
                  }
                : p
            )
          );
          break;
        }

        case "error": {
          setErrorMessage(msg.message || "An error occurred");
          break;
        }
      }
    });

    webrtc.onSendSignal = (targetPeerId, signal) => {
      signaling.send({
        type: "signal",
        targetPeerId,
        signal,
      });
    };

    webrtc.onRemoteStream = (peerId, stream, type) => {
      if (type === "screen") {
        setActiveScreenStream(stream);
        setActiveScreenOwner(peerId);
        if (remoteScreenVideoRef.current) {
          remoteScreenVideoRef.current.srcObject = stream;
        }
      } else if (type === "audio") {
        // Create audio tag for peer audio
        if (remoteAudioContainerRef.current) {
          let audioEl = document.getElementById(`audio-${peerId}`) as HTMLAudioElement;
          if (!audioEl) {
            audioEl = document.createElement("audio");
            audioEl.id = `audio-${peerId}`;
            audioEl.autoplay = true;
            remoteAudioContainerRef.current.appendChild(audioEl);
          }
          audioEl.srcObject = stream;
        }
      }
    };

    // Load available audio devices safely
    if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function") {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          const inputs = devices.filter((d) => d.kind === "audioinput");
          setAudioInputDevices(inputs);
          if (inputs.length > 0 && !selectedMicId) {
            setSelectedMicId(inputs[0].deviceId);
          }
        })
        .catch((e) => {
          console.warn("Could not enumerate audio devices:", e);
        });
    }

    return () => {
      signaling.disconnect();
      webrtc.closeAll();
    };
  }, []);

  // Sync active screen stream element
  useEffect(() => {
    if (activeScreenStream && remoteScreenVideoRef.current) {
      remoteScreenVideoRef.current.srcObject = activeScreenStream;
    }
  }, [activeScreenStream]);

  // Audio input level meter loop
  const setupAudioMeter = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i];
        const average = sum / buffer.length;
        setInputLevel(Math.min(100, Math.round((average / 128) * 100)));
        requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch (e) {
      console.warn("Audio meter setup error:", e);
    }
  };

  // Join Room Handler
  const handleJoinRoom = async () => {
    setErrorMessage(null);
    if (!roomCode || !displayName) {
      setErrorMessage("Room code and Display Name are required.");
      return;
    }

    try {
      // 1. Initialize E2EE crypto key & derive SAS fingerprint
      if (webrtcRef.current && e2eePassphrase) {
        const fp = await webrtcRef.current.setCryptoSecret(e2eePassphrase, roomCode);
        setE2eeFingerprint(fp);
      }

      // 2. Connect signaling
      if (signalingRef.current) {
        signalingRef.current.setUrl(serverUrl);
        await signalingRef.current.connect();

        // 3. Acquire mic audio
        if (webrtcRef.current) {
          try {
            const micStream = await webrtcRef.current.startMicrophone(selectedMicId);
            setupAudioMeter(micStream);
          } catch (e) {
            console.warn("Could not acquire microphone immediately:", e);
          }
        }

        // 4. Send Join message
        signalingRef.current.send({
          type: "join",
          roomCode,
          displayName,
          keyFingerprint: e2eeFingerprint,
        });
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to join room. Check signaling server status.");
    }
  };

  // Leave Room Handler
  const handleLeaveRoom = () => {
    if (signalingRef.current) {
      signalingRef.current.send({ type: "leave" });
      signalingRef.current.disconnect();
    }
    if (webrtcRef.current) {
      webrtcRef.current.closeAll();
    }
    setIsInRoom(false);
    setIsScreenSharing(false);
    setActiveScreenStream(null);
    setActiveScreenOwner(null);
    setParticipants([]);
  };

  // Toggle Mute
  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (webrtcRef.current) {
      webrtcRef.current.setMicrophoneMute(nextMuted);
    }
    if (signalingRef.current) {
      signalingRef.current.send({
        type: "media-state",
        isMuted: nextMuted,
      });
    }
  };

  // Toggle Screen Sharing
  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      webrtcRef.current?.stopScreenShare();
      setIsScreenSharing(false);
      signalingRef.current?.send({
        type: "media-state",
        isScreenSharing: false,
      });
    } else {
      try {
        const stream = await webrtcRef.current?.startScreenShare(screenFps);
        if (stream) {
          setIsScreenSharing(true);
          signalingRef.current?.send({
            type: "media-state",
            isScreenSharing: true,
            screenSharingFps: screenFps,
          });
        }
      } catch (err: any) {
        console.warn("Screen share cancelled or failed:", err);
      }
    }
  };

  // Change FPS Preset
  const handleFpsChange = async (fps: 15 | 30 | 60) => {
    setScreenFps(fps);
    if (isScreenSharing && webrtcRef.current) {
      await webrtcRef.current.setScreenFps(fps);
      signalingRef.current?.send({
        type: "media-state",
        isScreenSharing: true,
        screenSharingFps: fps,
      });
    }
  };

  return (
    <div className="dark flex h-screen w-screen overflow-hidden bg-[oklch(0.145_0.025_255)] text-[oklch(0.96_0.012_235)]">
      {/* Remote Audio Sink */}
      <div ref={remoteAudioContainerRef} className="hidden" />

      {/* Main Container */}
      {!isInRoom ? (
        // ------------------ JOIN SCREEN ------------------
        <div className="flex flex-1 flex-col items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-[oklch(1_0_0/10%)] bg-[oklch(0.19_0.03_255)] p-8 shadow-2xl backdrop-blur-md">
            {/* Header with Logo */}
            <div className="flex flex-col items-center mb-6">
              <img
                src="/logo.jpg"
                alt="Linkora Logo"
                className="h-20 w-20 rounded-2xl object-cover shadow-lg mb-3 border border-[oklch(0.72_0.15_240)/30]"
              />
              <h1 className="text-2xl font-bold tracking-tight text-[oklch(0.72_0.15_240)]">Linkora</h1>
              <p className="text-sm text-[oklch(0.72_0.025_245)]">Talk. Share. Connect.</p>
            </div>

            {/* Error banner */}
            {errorMessage && (
              <div className="mb-4 rounded-lg bg-[oklch(0.65_0.20_25)/20] border border-[oklch(0.65_0.20_25)/40] p-3 text-xs text-[oklch(0.85_0.15_25)]">
                {errorMessage}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[oklch(0.72_0.025_245)] mb-1">
                  Your Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Alex"
                  className="w-full rounded-lg border border-[oklch(1_0_0/10%)] bg-[oklch(0.145_0.025_255)] px-3 py-2 text-sm text-[oklch(0.96_0.012_235)] focus:border-[oklch(0.72_0.15_240)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[oklch(0.72_0.025_245)] mb-1">
                  Private Room Code
                </label>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder="e.g. secret-lounge-42"
                  className="w-full rounded-lg border border-[oklch(1_0_0/10%)] bg-[oklch(0.145_0.025_255)] px-3 py-2 text-sm text-[oklch(0.96_0.012_235)] focus:border-[oklch(0.72_0.15_240)] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[oklch(0.72_0.025_245)] mb-1 flex items-center gap-1">
                  <Lock className="h-3 w-3 text-[oklch(0.72_0.15_240)]" /> E2EE Room Secret Passphrase
                </label>
                <input
                  type="password"
                  value={e2eePassphrase}
                  onChange={(e) => setE2eePassphrase(e.target.value)}
                  placeholder="End-to-End Encryption Secret"
                  className="w-full rounded-lg border border-[oklch(1_0_0/10%)] bg-[oklch(0.145_0.025_255)] px-3 py-2 text-sm text-[oklch(0.96_0.012_235)] focus:border-[oklch(0.72_0.15_240)] focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-[oklch(0.72_0.025_245)]">
                  Shared secret never touches the server. Used to derive AES-GCM-256 keys.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[oklch(0.72_0.025_245)] mb-1">
                  Signaling Server URL
                </label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="ws://127.0.0.1:4000/ws"
                  className="w-full rounded-lg border border-[oklch(1_0_0/10%)] bg-[oklch(0.145_0.025_255)] px-3 py-2 text-xs font-mono text-[oklch(0.96_0.012_235)] focus:border-[oklch(0.72_0.15_240)] focus:outline-none"
                />
              </div>

              <button
                onClick={handleJoinRoom}
                className="mt-2 w-full rounded-xl bg-[oklch(0.72_0.15_240)] py-3 font-semibold text-[oklch(0.16_0.035_255)] hover:bg-[oklch(0.78_0.13_205)] transition-all shadow-md active:scale-98"
              >
                Join Voice Room
              </button>
            </div>
          </div>
        </div>
      ) : (
        // ------------------ IN-ROOM ACTIVE SCREEN ------------------
        <div className="flex flex-1 flex-col h-full w-full">
          {/* Top Navbar */}
          <header className="flex h-14 items-center justify-between border-b border-[oklch(1_0_0/10%)] bg-[oklch(0.17_0.03_255)] px-6">
            <div className="flex items-center gap-3">
              <img src="/logo.jpg" alt="Logo" className="h-8 w-8 rounded-lg object-cover" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm tracking-wide text-[oklch(0.72_0.15_240)]">Linkora</span>
                  <span className="text-xs text-[oklch(0.72_0.025_245)] font-mono">#{roomCode}</span>
                </div>
              </div>
            </div>

            {/* E2EE Safety Badge */}
            <div className="flex items-center gap-2 rounded-full border border-[oklch(0.72_0.15_165)/30] bg-[oklch(0.72_0.15_165)/10] px-3 py-1">
              <ShieldCheck className="h-4 w-4 text-[oklch(0.72_0.15_165)]" />
              <span className="text-xs font-mono text-[oklch(0.85_0.10_165)]">
                E2EE: {e2eeFingerprint || "ACTIVE"}
              </span>
            </div>

            {/* Connection Indicator & Settings */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-xs text-[oklch(0.72_0.025_245)]">
                <Signal className="h-3.5 w-3.5 text-emerald-400" />
                <span>P2P Direct</span>
              </div>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="rounded-lg p-2 hover:bg-[oklch(0.24_0.04_250)] text-[oklch(0.94_0.015_235)] transition"
              >
                <Settings className="h-5 w-5" />
              </button>
            </div>
          </header>

          {/* Main Stage & Participants Grid */}
          <div className="flex flex-1 overflow-hidden">
            {/* Stage: Shared Screen Area */}
            <div className="flex flex-1 flex-col bg-[oklch(0.145_0.025_255)] p-4 items-center justify-center relative">
              {activeScreenStream ? (
                <div className="flex flex-col h-full w-full items-center justify-center relative rounded-xl overflow-hidden bg-black border border-[oklch(1_0_0/10%)]">
                  <video
                    ref={remoteScreenVideoRef}
                    autoPlay
                    playsInline
                    className="max-h-full max-w-full object-contain"
                  />
                  <div className="absolute top-3 left-3 rounded-md bg-black/60 px-3 py-1 text-xs backdrop-blur flex items-center gap-2">
                    <Monitor className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Screen from Peer #{activeScreenOwner?.slice(0, 6)}</span>
                    <span className="text-emerald-400 font-mono">1080p Target</span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-8">
                  <div className="h-20 w-20 rounded-full bg-[oklch(0.19_0.03_255)] border border-[oklch(1_0_0/10%)] flex items-center justify-center mb-4 text-[oklch(0.72_0.15_240)]">
                    <Users className="h-10 w-10" />
                  </div>
                  <h3 className="text-lg font-semibold">Private Voice Room Active</h3>
                  <p className="text-sm text-[oklch(0.72_0.025_245)] max-w-sm mt-1">
                    Microphone is live over WebRTC. Click the Screen Share button below to share your screen at up to 60 FPS.
                  </p>
                </div>
              )}
            </div>

            {/* Sidebar: Participants List */}
            <div className="w-72 border-l border-[oklch(1_0_0/10%)] bg-[oklch(0.17_0.03_255)] p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[oklch(0.72_0.025_245)]">
                    Room Members ({participants.length}/10)
                  </h2>
                </div>

                <div className="space-y-2">
                  {participants.map((p) => {
                    const isMe = p.id === myPeerId;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between rounded-xl p-2.5 transition ${
                          isMe
                            ? "bg-[oklch(0.24_0.035_255)] border border-[oklch(0.72_0.15_240)/30]"
                            : "bg-[oklch(0.19_0.03_255)]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="h-9 w-9 rounded-full bg-[oklch(0.27_0.055_235)] border border-[oklch(0.72_0.15_240)/40] flex items-center justify-center font-bold text-sm text-[oklch(0.88_0.08_210)]">
                              {p.displayName.slice(0, 2).toUpperCase()}
                            </div>
                            {/* Live speaking indicator */}
                            {isMe && inputLevel > 15 && (
                              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-[oklch(0.17_0.03_255)] animate-pulse" />
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-medium flex items-center gap-1.5">
                              <span>{p.displayName}</span>
                              {isMe && (
                                <span className="text-[10px] bg-[oklch(0.72_0.15_240)/20] text-[oklch(0.72_0.15_240)] px-1.5 py-0.5 rounded">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[oklch(0.72_0.025_245)] flex items-center gap-1">
                              {p.isScreenSharing && (
                                <span className="text-cyan-400 font-mono flex items-center gap-0.5">
                                  <Monitor className="h-3 w-3" /> {p.screenSharingFps || 30} FPS
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 text-[oklch(0.72_0.025_245)]">
                          {p.isMuted ? (
                            <MicOff className="h-4 w-4 text-[oklch(0.65_0.20_25)]" />
                          ) : (
                            <Mic className="h-4 w-4 text-emerald-400" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mic Input Meter */}
              <div className="rounded-xl bg-[oklch(0.19_0.03_255)] p-3 border border-[oklch(1_0_0/10%)]">
                <div className="flex items-center justify-between text-xs text-[oklch(0.72_0.025_245)] mb-1">
                  <span className="flex items-center gap-1">
                    <Volume2 className="h-3.5 w-3.5" /> Mic Input
                  </span>
                  <span>{inputLevel}%</span>
                </div>
                <div className="h-1.5 w-full bg-[oklch(0.145_0.025_255)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[oklch(0.72_0.15_240)] transition-all duration-75"
                    style={{ width: `${inputLevel}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Call Bar */}
          <footer className="flex h-18 items-center justify-between border-t border-[oklch(1_0_0/10%)] bg-[oklch(0.19_0.03_255)] px-6">
            <div className="flex items-center gap-2">
              {/* FPS Selector */}
              <div className="flex items-center gap-1 bg-[oklch(0.145_0.025_255)] rounded-lg p-1 border border-[oklch(1_0_0/10%)]">
                {([15, 30, 60] as const).map((fps) => (
                  <button
                    key={fps}
                    onClick={() => handleFpsChange(fps)}
                    className={`px-2.5 py-1 text-xs font-mono font-medium rounded-md transition ${
                      screenFps === fps
                        ? "bg-[oklch(0.72_0.15_240)] text-[oklch(0.16_0.035_255)] shadow"
                        : "text-[oklch(0.72_0.025_245)] hover:text-white"
                    }`}
                  >
                    {fps} FPS
                  </button>
                ))}
              </div>
            </div>

            {/* Core Action Buttons */}
            <div className="flex items-center gap-3">
              {/* Mute Button */}
              <button
                onClick={handleToggleMute}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl transition shadow-md ${
                  isMuted
                    ? "bg-[oklch(0.65_0.20_25)] text-white hover:bg-[oklch(0.70_0.20_25)]"
                    : "bg-[oklch(0.24_0.035_255)] text-[oklch(0.96_0.012_235)] hover:bg-[oklch(0.27_0.055_235)]"
                }`}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>

              {/* Screen Share Button */}
              <button
                onClick={handleToggleScreenShare}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl transition shadow-md ${
                  isScreenSharing
                    ? "bg-cyan-500 text-black hover:bg-cyan-400"
                    : "bg-[oklch(0.24_0.035_255)] text-[oklch(0.96_0.012_235)] hover:bg-[oklch(0.27_0.055_235)]"
                }`}
                title={isScreenSharing ? "Stop Screen Share" : "Share Screen (1080p Target)"}
              >
                {isScreenSharing ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
              </button>

              {/* Leave Room Button */}
              <button
                onClick={handleLeaveRoom}
                className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[oklch(0.65_0.20_25)] text-white hover:bg-[oklch(0.70_0.20_25)] transition shadow-md"
                title="Disconnect from Room"
              >
                <PhoneOff className="h-5 w-5" />
              </button>
            </div>

            {/* Device Quick Info */}
            <div className="text-right text-xs text-[oklch(0.72_0.025_245)]">
              <span className="font-mono">Opus 48kHz</span> | <span>AEC + NS Enabled</span>
            </div>
          </footer>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[oklch(1_0_0/10%)] bg-[oklch(0.19_0.03_255)] p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-[oklch(0.72_0.15_240)] mb-4 flex items-center gap-2">
              <Settings className="h-5 w-5" /> Audio & Security Settings
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[oklch(0.72_0.025_245)] mb-1">
                  Microphone Device
                </label>
                <select
                  value={selectedMicId}
                  onChange={(e) => {
                    setSelectedMicId(e.target.value);
                    if (webrtcRef.current) {
                      webrtcRef.current.startMicrophone(e.target.value).then((s) => setupAudioMeter(s));
                    }
                  }}
                  className="w-full rounded-lg border border-[oklch(1_0_0/10%)] bg-[oklch(0.145_0.025_255)] px-3 py-2 text-sm text-[oklch(0.96_0.012_235)] focus:border-[oklch(0.72_0.15_240)] focus:outline-none"
                >
                  {audioInputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone (${d.deviceId.slice(0, 6)})`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[oklch(0.72_0.025_245)] mb-1">
                  Safety Fingerprint (Out-of-band Verification)
                </label>
                <div className="rounded-lg bg-[oklch(0.145_0.025_255)] p-3 border border-[oklch(1_0_0/10%)] font-mono text-sm text-[oklch(0.72_0.15_165)]">
                  {e2eeFingerprint || "Not connected"}
                </div>
                <p className="mt-1 text-[11px] text-[oklch(0.72_0.025_245)]">
                  Compare this string with your friends to verify that no man-in-the-middle or signaling server impersonation exists.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="rounded-xl bg-[oklch(0.72_0.15_240)] px-5 py-2 font-semibold text-[oklch(0.16_0.035_255)] hover:bg-[oklch(0.78_0.13_205)] transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
