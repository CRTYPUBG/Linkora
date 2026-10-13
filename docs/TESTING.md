# Two-Computer Real-World Testing Guide for Linkora

Follow these steps to run and test real-time P2P voice and 1080p screen-sharing between two Windows PCs over different internet connections.

---

### Step 1: Deploy Signaling & TURN Server (Single Ubuntu VPS)

On your Ubuntu VPS with a public IP (e.g. `203.0.113.10`):

1. Clone and navigate to the project:
   ```bash
   git clone <repo-url> linkora
   cd linkora
   ```
2. Configure `.env`:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Set:
   ```ini
   EXTERNAL_IP=203.0.113.10
   TURN_SECRET=change_to_a_secure_token_1234
   TURN_URLS=turn:203.0.113.10:3478?transport=udp,turn:203.0.113.10:3478?transport=tcp
   ```
3. Open firewall ports (UFW):
   ```bash
   sudo ufw allow 4000/tcp        # Signaling WebSocket
   sudo ufw allow 3478/tcp        # TURN/STUN TCP
   sudo ufw allow 3478/udp        # TURN/STUN UDP
   sudo ufw allow 49152:65535/udp # TURN Media UDP Relay
   sudo ufw reload
   ```
4. Start services:
   ```bash
   docker compose up -d --build
   ```
5. Verify health:
   ```bash
   curl http://localhost:4000/health
   # Returns: {"status":"ok","service":"linkora-signaling-server"}
   ```

---

### Step 2: Build & Launch Linkora on PC 1 and PC 2

On each Windows machine:

1. Clone or copy the Linkora repository.
2. Build the application or start dev mode:
   ```powershell
   npm run build:shared
   npm run build:crypto
   npm --workspace=apps/desktop run tauri dev
   ```
   *(Or build installer with `npm --workspace=apps/desktop run tauri build`)*

---

### Step 3: Connect & Test in Room

1. On **PC 1** (e.g., Home Wi-Fi):
   - **Display Name**: `PC1-Host`
   - **Room Code**: `secret-friends-lounge`
   - **E2EE Passphrase**: `OurSharedSecret2026!`
   - **Signaling Server URL**: `ws://203.0.113.10:4000/ws` *(your VPS IP)*
   - Click **Join Voice Room**.
   - Note the **Safety Fingerprint** badge (e.g., `A3F1-92D0-44BC-7E11`).

2. On **PC 2** (e.g., Mobile Hotspot / Different Network):
   - **Display Name**: `PC2-Guest`
   - **Room Code**: `secret-friends-lounge`
   - **E2EE Passphrase**: `OurSharedSecret2026!`
   - **Signaling Server URL**: `ws://203.0.113.10:4000/ws`
   - Click **Join Voice Room**.

3. **Verify Fingerprint**:
   - Compare the Safety Fingerprint badge on PC 1 and PC 2. Both must match identically.

4. **Verify Voice Quality**:
   - Speak into PC 1's microphone: the green ring around the avatar on PC 1 pulses, and PC 2 hears clear Opus 48kHz audio without echo.
   - Click **Mute**: verify microphone transmission ceases.

5. **Verify 1080p Screen Sharing & FPS Switching**:
   - On PC 1, click **Monitor Icon** and select a monitor or window (e.g. a 60 FPS video or game).
   - PC 2 displays the video stream in the central stage at 1080p target.
   - Click **60 FPS**: stream adapts to 4.5 Mbps bitrate target and 60 FPS cap.
   - Click **15 FPS**: stream immediately adapts down to 1.0 Mbps bitrate cap and 15 FPS.
   - Click **Stop Screen Share**: remote stream cleanly detaches.
