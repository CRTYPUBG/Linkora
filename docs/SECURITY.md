# Linkora Security, Cryptography & Trust Model

## 1. Cryptographic Architecture

### Transport Layer
- **Media Streams (WebRTC)**: Standard DTLS 1.2/1.3 with SRTP (AES-128-GCM or AES-256-GCM) ensures transport-level encryption between peers and any intervening TURN relay.
- **Signaling Channel**: WSS (WebSocket over TLS 1.3).

### Application Layer (E2EE)
- **Key Derivation**: 256-bit AES key derived from a shared secret passphrase and unique room salt (`linkora-salt-{roomCode}`) using **PBKDF2** with **100,000 iterations** of **SHA-256**.
- **Cipher**: **AES-GCM-256** with 128-bit authentication tags.
- **IV Construction**: 12-byte IV consisting of a 4-byte static protocol prefix (`LK\x01`) and an 8-byte big-endian monotonic transmission counter (`sendCounter`).
- **Sliding-Window Replay Protection**: RFC 6479-inspired sliding-window mechanism (window size: 1024 frames) tracking received frame counters per sender hash. This allows legitimate out-of-order UDP packet delivery without dropping packets, while strictly rejecting duplicate/replayed frames and frames outside the window.

## 2. Safety Fingerprints (Short Authentication Strings)
- To prevent man-in-the-middle attacks and signaling server impersonation, Linkora calculates an out-of-band **Safety Fingerprint**:
  $$\text{Fingerprint} = \text{Hex}(\text{SHA-256}(K_{\text{derived}}))[0..16]$$
  formatted into chunks: `XXXX-XXXX-XXXX-XXXX`.
- Participants compare this string out-of-band (e.g. over voice or secondary channel).

## 3. Honest Status of WebRTC Encoded Transform in WebView2
- **Standard WebRTC (DTLS-SRTP)** is 100% functional and verified across Windows WebView2.
- While the Linkora cryptographic package (`@linkora/crypto`) provides fully tested AES-GCM-256 frame payload encryption and sliding-window replay protection, native Chromium `RTCRtpScriptTransform` / WebRTC Insertable Streams have variable experimental availability depending on the host's installed Microsoft Edge WebView2 runtime version.
- **Honest Security Distinction**: DTLS-SRTP ensures that the signaling server never sees media content. Only a designated TURN relay can forward encrypted UDP packets (unable to decrypt them without DTLS keys). Application-level frame encryption can be layered whenever WebView2 runtime flags enable encoded transform workers.

## 4. Metadata Visibility
- **Visible to Signaling Server**:
  - Peer display names.
  - Room identifiers.
  - Connection timestamps.
  - Client IP addresses (for WebSocket connections).
- **Hidden from Signaling Server**:
  - Audio content.
  - Video and screen-sharing contents.
  - E2EE passphrase and derived cryptographic keys.
