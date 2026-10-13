# Linkora Architecture & Technical Design

## Overview
**Linkora** is a private, lightweight, peer-to-peer (P2P) voice communication and high-framerate screen-sharing desktop application built for friends and small teams.

```
[ Desktop Client A ] <======== P2P Direct (DTLS-SRTP / Encrypted) ========> [ Desktop Client B ]
        \                                                                           /
         \                                                                         /
    WebSocket (TLS)                                                           WebSocket (TLS)
           \                                                                     /
            v                                                                   v
     +-----------------------------------------------------------------------------+
     |                       Linkora Signaling Server (Fastify)                    |
     |            - Room access validation & in-memory peer discovery              |
     |            - Time-limited ephemeral HMAC TURN credential generation         |
     +-----------------------------------------------------------------------------+
                                            | (Fallback relay only)
                                            v
     +-----------------------------------------------------------------------------+
     |                               Coturn Server                                 |
     |                      STUN & Authenticated TURN Relay                        |
     +-----------------------------------------------------------------------------+
```

## Security & End-to-End Encryption
1. **Transport Layer Security**: Signaling runs strictly over WSS/TLS. WebRTC media streams run over DTLS-SRTP.
2. **Application Layer E2EE**: Key material is derived locally on the clients using PBKDF2 (100,000 iterations of SHA-256) with room-specific salts. Plaintext secrets and cryptographic keys are **never** shared with the signaling server.
3. **Out-of-band Verification**: Every session exposes an 8-character Safety Fingerprint (Short Authentication String) so peers can verify against server impersonation.
4. **Replay Attack Protection**: Frame headers maintain monotonic 64-bit counters with bounded sliding-window checks.

## Voice Engineering
- **Codec**: Opus codec at 48kHz sampling rate.
- **Processing**: Hardware-accelerated Acoustic Echo Cancellation (AEC), Noise Suppression (NS), and Automatic Gain Control (AGC).
- **Speaking Activity**: Real-time Web Audio API `AnalyserNode` monitoring with visual avatar ring glow.

## Screen Sharing Presets & 10-Person P2P Mesh Dynamics
- **1080p Target**: Maximum 1920x1080 capture canvas.
- **FPS Presets**:
  - `60 FPS`: Ultra smooth gaming preset (4.5 Mbps bitrate cap).
  - `30 FPS`: Balanced standard preset (2.5 Mbps bitrate cap).
  - `15 FPS`: Bandwidth-saving preset (1.0 Mbps bitrate cap).

### Upstream Bandwidth in a 10-Person P2P Mesh
In a full P2P mesh network with $N = 10$ participants:
- **Audio Only**: Each user sends 1 Opus stream to 9 peers ($9 \times 40 \text{ kbps} \approx 360 \text{ kbps}$ upload). This is easily handled by any home broadband connection.
- **Screen Sharing**: When 1 participant shares 1080p60 to 9 peers, the sharing user must upload 9 parallel streams ($9 \times 4.5 \text{ Mbps} \approx 40.5 \text{ Mbps}$ upload). The screen-sharing host must have at least **50 Mbps upload speed** for smooth 10-person 1080p60 P2P sharing without an SFU.
- **Zero Media on Server**: The signaling server processes **0 bytes** of audio and **0 bytes** of screen sharing. Server CPU usage remains virtually 0%, with no media transcoding, decoding, or recording.

## Measured Signaling Server Resource Footprint
Measured on Node.js v22 LTS:
- **RSS (Resident Set Size)**: $\approx 61.27 \text{ MB}$
- **V8 Heap Used**: $\approx 11.16 \text{ MB}$
- **V8 Heap Total**: $\approx 21.12 \text{ MB}$
- Fits comfortably within free cloud tiers (e.g. Railway 512 MB RAM / 2 vCPU).
