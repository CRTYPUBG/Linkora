Senin için en doğru yaklaşım, arkadaşlarınla özel odada konuşabileceğin, ekran paylaşımı yapabileceğin ve tüm iletişimi uçtan uca şifreleyen Discord benzeri, ancak tek sunuculu ve P2P destekli bir masaüstü uygulaması geliştirmek.

Antigravity'deki ajanına tek seferde vereceğimiz prompt, sadece tasarım oluşturmasını değil; çalışan uygulamayı, gerçek sesli iletişimi, ekran paylaşımını, şifrelemeyi, sunucu altyapısını, testleri ve dağıtım dosyalarını da hazırlamasını isteyecek.

## Seçtiğim teknoloji mimarisi

| Katman                    | Teknoloji                                              | Neden?                                       |
| ------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| Masaüstü uygulama         | Tauri 2 + React + TypeScript                           | Hafif, modern Windows uygulaması             |
| Gerçek zamanlı iletişim   | WebRTC                                                 | P2P ses ve ekran paylaşımı                   |
| Ses                       | Opus + WebRTC Audio Processing                         | Net konuşma, yankı ve gürültü azaltma        |
| Ekran paylaşımı           | WebRTC + Windows ekran yakalama                        | 1080p, 60 FPS hedefi                         |
| Sunucu                    | Node.js + TypeScript + Fastify                         | Tek merkezden oda ve sinyalleşme yönetimi    |
| Gerçek zamanlı mesajlaşma | WebSocket                                              | Oda üyeleri ve bağlantı koordinasyonu        |
| E2E şifreleme             | WebRTC DTLS-SRTP + uygulama düzeyinde anahtar yönetimi | Ses ve video akışlarının korunması           |
| NAT geçişi                | STUN + coturn TURN                                     | Farklı ağlardaki arkadaşların bağlanabilmesi |
| İlk dağıtım               | Docker Compose + VPS                                   | Tek sunucuda kolay kurulum ve kontrol        |

Önemli mimari kararı: Ses ve görüntü normalde doğrudan P2P akar; sunucu oda yönetimi ve bağlantı kurma işlerini üstlenir. P2P bağlantısı kurulamayan kullanıcılar için TURN rölesi kullanılabilir. Bu nedenle tek bir VPS ile başlamak mümkün olsa da tüm arkadaşların bağlantı koşullarında her zaman doğrudan P2P garantisi verilemez.

## Antigravity için tek parça geliştirme promptu

Aşağıdaki promptu doğrudan Antigravity'ye yapıştır. Ajanın mevcut projeyi incelemesini ve ardından soru sormadan uygulamayı gerçekten geliştirmesini hedefliyor.

# PROJECT: PRIVATE P2P VOICE & SCREEN SHARING — PRODUCTION-MINDED PoC

You are the lead software architect, senior full-stack engineer, WebRTC specialist, desktop application engineer, and application security engineer.

Your task is to **build a working application, not merely produce a plan, mockup, prototype UI, or documentation**.

Start by inspecting the current workspace, then implement the application directly in the existing project. If the workspace is empty, initialize the project. Make sensible technical decisions without asking me questions. Work autonomously until the working PoC is implemented, tested, documented, and buildable.

## 1. Product vision

Build a lightweight, modern, Discord-inspired private desktop application that lets friends:

- Join one private voice room.
- Talk to each other in real time with exceptionally clear voice quality.
- Share their entire screen or an individual application window.
- Watch shared screens at 1080p and target up to 60 FPS.
- Select 60 FPS, 30 FPS, or 15 FPS.
- Mute and unmute their microphone.
- Select microphone and speaker devices.
- See room members and connection quality.
- Join using a private invitation or room code.
- Communicate with end-to-end encryption.
- Connect over the internet without requiring port forwarding on every participant's home router.

This is a single-room, friends-only, peer-to-peer proof of concept. Do not build an unnecessarily complicated Discord clone.

The priority order is:

1. Working voice communication.
2. Working private room and participant management.
3. Working screen sharing.
4. Verifiable end-to-end encryption.
5. Excellent audio quality.
6. Reliable internet connectivity.
7. A polished desktop UI.
8. Simple deployment to one server.

## 2. Choose and implement the stack

Use the following stack unless a concrete compatibility issue requires a documented alternative.

### Desktop client

- Tauri 2.
- React.
- TypeScript with strict mode.
- Vite.
- Tailwind CSS.
- shadcn/ui where appropriate.
- Lucide icons.
- WebView2 on Windows.
- Official Tauri plugins for window management, permissions, and native functionality when needed.

The primary target is Windows 10 and Windows 11 x64.

Build an actual desktop application, not just a website running in a browser. Provide a working development environment and a Windows installer build.

### Signaling server

- Node.js LTS.
- TypeScript.
- Fastify.
- WebSocket using a maintained library.
- Zod for input validation.
- Vitest for tests.
- Docker for deployment.

The signaling server must coordinate room membership, authenticated invitations, WebRTC offers and answers, ICE candidates, presence, and connection state.

It must NOT carry ordinary voice or screen-sharing media when direct P2P connectivity is possible.

### Voice and video transport

- WebRTC.
- Opus audio.
- DTLS-SRTP for WebRTC transport security.
- ICE for connectivity establishment.
- STUN for public-address discovery.
- coturn for authenticated TURN relay fallback.
- Adaptive bitrate and congestion handling.
- WebRTC statistics for monitoring connection health.

Prefer direct peer-to-peer media connections. If direct connectivity fails, use the configured TURN relay.

Do not introduce an SFU or a large media server into the first PoC unless a demonstrated technical limitation makes it necessary.

### Persistence

Keep the initial deployment simple:

- One signaling server.
- One private voice room.
- Minimal configuration and secrets.
- In-memory presence for the initial PoC.
- No PostgreSQL, Redis, or external managed database unless genuinely required.

Room state may reset when the server restarts. Document this behavior.

Do not store audio, video, screen recordings, or encryption keys on the server.

## 3. Architecture

Create a clear repository structure similar to:

apps/\
desktop/\
signaling-server/

packages/\
shared/\
crypto/

infra/\
docker/\
coturn/

docs/\
ARCHITECTURE.md\
SECURITY.md\
DEPLOYMENT.md\
TESTING.md

The exact structure can change if the existing project has a better organization. Keep the implementation maintainable and avoid unnecessary abstraction.

### Connection flow

1. The user opens the desktop app.
2. The client connects to the signaling server over authenticated TLS.
3. The user enters a room code or follows a private invitation.
4. The server validates the invitation and room capacity.
5. Participants negotiate WebRTC connections.
6. The clients establish secure media connections.
7. Audio streams travel directly between peers whenever possible.
8. Screen sharing starts only after the user explicitly selects a screen or window.
9. TURN relays encrypted packets only when required.
10. Leaving the room closes media tracks, peer connections, and temporary room credentials.

The signaling server is not trusted with media plaintext or encryption secrets.

Clearly distinguish signaling connectivity from media connectivity in the UI.

## 4. Voice quality: make this a priority

Implement actual microphone capture and WebRTC audio communication.

Configure the Opus codec for speech quality, subject to browser/WebView capabilities and WebRTC negotiation.

Use supported audio-processing features for:

- Acoustic echo cancellation.
- Noise suppression.
- Automatic gain control.
- Stable voice levels.
- Low-latency, full-duplex conversation.

Provide microphone and speaker selection, a microphone test, a live input-level meter, and a mute button.

Avoid aggressive noise suppression that destroys natural speech. Use supported native WebRTC audio processing rather than inventing a fake audio-processing implementation.

Use adaptive jitter buffering and WebRTC's built-in congestion control. Prefer intelligible, stable audio over unnecessarily high bitrate.

Show useful connection statistics where available:

- Round-trip time.
- Packet loss.
- Jitter.
- Selected candidate-pair type.
- Current audio connection state.

Do not promise studio-quality audio on every microphone, network, or device. Optimize for clear, natural, reliable speech.

## 5. Screen sharing requirements

Implement real screen sharing with explicit operating-system permission and user consent.

Provide three frame-rate presets:

- 60 FPS — smooth motion and gaming.
- 30 FPS — balanced default.
- 15 FPS — bandwidth-saving mode.

Use 1920×1080 as the maximum target resolution for the initial PoC. Support lower resolutions when the source or network cannot sustain the target.

Requirements:

- Select an entire monitor or an application window.
- Start and stop sharing.
- Display a visible sharing indicator.
- Display the stream to authorized room participants.
- Show the source resolution and measured frame rate where available.
- Provide adaptive degradation when the network becomes congested.
- Stop sharing immediately when the user ends it or leaves the room.
- Never capture the screen silently.
- Never bypass operating-system capture permissions.

Use the available Tauri/WebView2 screen-capture capabilities and native integrations where necessary.

Before implementing the UI, verify that the selected screen-capture APIs work in the actual Windows WebView2 environment. If they require a permission handler, native plugin, or alternative implementation, implement it.

Do not substitute a prerecorded video, canvas animation, simulated FPS counter, or mock stream for real screen sharing.

### Frame-rate and bitrate policy

Treat 1080p60 as a target, not an unconditional guarantee.

Use sensible starting bitrate targets for 1080p sharing, then adapt to measured bandwidth, packet loss, and CPU load. Keep bitrate settings configurable.

When bandwidth is insufficient, reduce bitrate or resolution before allowing the connection to become unusable.

The 30 FPS and 15 FPS options must change the actual capture/encoding behavior, not just the displayed label.

Measure and report actual outgoing and incoming FPS where supported.

## 6. End-to-end encryption — security-critical requirement

Security is a core product feature, not a marketing label.

Implement and document the actual cryptographic trust model.

### Transport encryption

Use WebRTC DTLS-SRTP for peer media connections and TLS for signaling.

Transport encryption alone must NOT be presented as proof that the application has a fully verified end-to-end encryption system.

### Application-level media E2EE

Implement an additional application-level media encryption layer for audio and screen video if the chosen WebView2 implementation supports the required WebRTC encoded-frame transformation APIs.

Use a maintained, audited cryptographic library and standard cryptographic primitives. Do not invent a cipher or cryptographic protocol.

Requirements:

- Authenticated encryption.
- Unique nonces or counters according to the chosen cipher's requirements.
- Per-room and per-session key separation.
- Secure key generation using a cryptographically secure random source.
- Defined key distribution and participant authentication.
- Replay and malformed-frame protection where applicable.
- Key rotation and cleanup on room changes.
- No encryption keys sent to the signaling server.
- No keys or plaintext media written to logs.
- No silent downgrade to unencrypted media.

Prefer a well-established group key-management protocol or an established implementation suitable for a small group. Document the selected design and its limitations.

The room invitation secret must not be confused with a media encryption key. Derive or exchange separate keys using a suitable standard construction.

Authenticate key exchanges against signaling-server impersonation. A malicious signaling server must not be able to silently substitute participant keys.

Provide a short authentication string or fingerprint verification flow that users can compare through a separate trusted channel.

If a secure, compatible encoded-frame E2EE implementation cannot be completed, implement the secure transport layer and clearly mark application-level E2EE as incomplete. Fail closed for any feature explicitly advertised as application-level E2EE. Do not claim that the complete application is E2EE until the implementation and its tests demonstrate that property.

### Metadata and server trust

Document which metadata the server can see, including room membership, connection timing, IP addresses, and signaling metadata.

Do not claim that E2EE hides network addresses from peers, TURN infrastructure, or the signaling server when it does not.

## 7. Private rooms and access control

The PoC should initially expose one configurable private room.

Implement:

- Cryptographically random invitation codes or secrets.
- Short-lived join credentials.
- Server-side room capacity limits.
- Rate limiting on join and signaling operations.
- Input validation.
- Connection limits.
- Rejection of unauthorized room joins.
- Safe cleanup when participants disconnect.
- Graceful handling of duplicate sessions.
- A configurable participant limit.

Use a small, configurable default capacity, such as 6 participants, and make it easy to change.

Only authenticated room members may exchange signaling messages for that room.

Never accept arbitrary target peer IDs without checking room membership.

Do not put permanent server secrets or privileged TURN credentials in the desktop application's source code.

Generate time-limited TURN credentials on the server. Use environment variables for private configuration.

## 8. User interface and design

Build a premium, modern desktop UI. Do not copy Discord pixel for pixel.

Visual direction:

- Dark graphite background.
- Deep navy surfaces.
- Restrained blue and cyan accents.
- Subtle borders and gradients.
- Clear typography.
- Fluent-inspired desktop interactions.
- Lucide icons.
- Minimal animations.
- No excessive neon, clutter, or giant empty panels.

Create these screens:

### Main room screen

- Application title and connection status.
- Room name and participant count.
- Participant avatars or initials.
- Speaking indicators.
- Microphone mute/unmute.
- Audio device selector.
- Screen-sharing controls.
- FPS selector with 60, 30, and 15 FPS.
- Leave-room button.
- Connection-quality indicators.

### Join screen

- Private room code input.
- Join button.
- Server connection status.
- Clear validation and error messages.

### Screen-sharing view

- Main shared-content area.
- Sharing participant identity.
- Actual incoming stream.
- Stream resolution and FPS statistics.
- Full-screen option.
- Clear sharing and connection indicators.

### Settings

- Microphone.
- Speakers.
- Audio processing toggles where supported.
- Screen-sharing quality.
- Signaling server URL.
- TURN connectivity status.
- E2EE status and fingerprint verification.
- Diagnostic information.

Every button must perform a real action. Every form must validate input. Include loading, empty, permission-denied, disconnected, and error states.

Do not leave decorative controls that appear functional but do nothing.

## 9. Deployment: one server

Design the first deployment for one Ubuntu 24.04 LTS VPS.

Use Docker Compose with:

- The Node.js signaling service.
- coturn.
- Caddy or an equivalent maintained TLS reverse proxy where appropriate.
- Health checks.
- Restart policies.
- Persistent configuration and certificate storage where necessary.

Keep all services in one deployment and document the network requirements.

Expose only the ports needed by the selected configuration. Protect administrative interfaces and do not expose TURN management endpoints publicly.

Configure secure, time-limited TURN authentication.

Document DNS, HTTPS/WSS, TLS certificates, UDP networking, TURN relay port ranges, firewall configuration, and environment variables.

Provide:

- docker-compose.yml.
- .env.example without real credentials.
- Dockerfiles.
- Health endpoint.
- Deployment guide.
- Upgrade and rollback instructions.
- Troubleshooting guide.

Railway or Render may be used for signaling if compatible, but do not assume that ordinary application hosting supports TURN's required UDP relay behavior. Prefer a VPS for the initial all-in-one deployment because it provides control over UDP ports and firewall rules.

Do not make a paid cloud account or live deployment a prerequisite for developing the PoC.

The local development version must work with documented local settings. Production secrets must never be committed.

## 10. Security and reliability

Implement:

- Strict server-side validation.
- Origin and WebSocket upgrade validation.
- TLS in production.
- Secure invitation handling.
- Rate limiting.
- Safe error messages.
- Dependency auditing.
- Secret redaction in logs.
- Resource limits.
- WebSocket heartbeat and dead-peer cleanup.
- Graceful shutdown.
- Peer reconnection and ICE restart where appropriate.
- Permission-denied handling.
- Defensive handling of malformed messages.
- Protection against room impersonation and unauthorized signaling.
- A restrictive Content Security Policy where compatible with the Tauri architecture.

Do not store conversations or recordings.

Do not add analytics, advertising, telemetry uploads, or third-party tracking by default.

Do not disable certificate verification or use insecure TLS fallbacks to make a connection succeed.

## 11. Testing requirements

Create automated tests for the signaling server and security-critical shared logic.

At minimum, test:

1. A valid participant can join the private room.
2. An unauthorized participant cannot join.
3. An invalid invitation is rejected.
4. Room capacity is enforced.
5. Signaling messages cannot be forwarded across unrelated rooms.
6. Invalid WebSocket messages are rejected safely.
7. Disconnect cleanup works.
8. Rate limiting works.
9. E2EE key-management logic passes relevant test vectors.
10. Encrypted media frames cannot be decrypted without the correct key.
11. Tampered ciphertext is rejected.
12. Replay handling follows the documented design.
13. A TURN configuration does not expose permanent credentials.
14. The desktop application builds for Windows.
15. Screen capture permissions and frame-rate controls are tested in the supported Windows environment.

Add integration tests for WebRTC negotiation and document which tests require multiple actual clients, microphones, or a real network.

If a test cannot run in the current environment, explicitly report why and provide a reproducible test command.

Do not fabricate successful test results.

## 12. Build and execution

Inspect installed tools and available dependencies before deciding which commands can run.

Provide root-level commands for:

- Installing dependencies.
- Starting the local signaling server.
- Starting the desktop app.
- Running unit tests.
- Running integration tests.
- Building the Windows application.
- Starting the Docker deployment.

Create convenient Windows scripts if useful, such as:

- scripts/dev.ps1
- scripts/test.ps1
- scripts/build-windows.ps1

Build the application and fix actual compilation errors.

Do not leave placeholder functions for the core voice, WebRTC, room, screen-sharing, or encryption flows.

If external services or credentials are unavailable, complete everything that can be built locally and clearly document the remaining configuration.

## 13. Execution instructions

Work directly in the existing workspace.

First inspect the repository, current files, available tooling, and build environment. Then create a concise implementation checklist and immediately start implementing.

Do not stop after producing architecture diagrams or a project plan.

Implement in this order:

Phase 1: Repository setup, shared types, signaling server, room access control.

Phase 2: Tauri desktop shell, room interface, and WebSocket signaling.

Phase 3: Actual microphone capture, P2P WebRTC audio, Opus, device selection, and audio-processing controls.

Phase 4: Real screen sharing, 1080p target, 60/30/15 FPS presets, and adaptive quality.

Phase 5: TURN fallback and real-world connection testing.

Phase 6: E2EE key management, media-frame encryption where compatible, fingerprint verification, and security tests.

Phase 7: UI polish, error states, automated tests, Windows build, Docker deployment, and documentation.

Adjust this order if dependencies require it, but keep the application buildable throughout development.

When finished, provide a concise report containing:

- What was actually implemented.
- Which features were verified to work.
- Which tests were executed and their real results.
- How to run the app locally.
- How to deploy the single-server setup.
- The Windows installer/build output location.
- Any remaining limitations or security gaps.

Do not claim 1080p60 performance, full E2EE, successful internet connectivity, or a production-ready security posture unless each claim is supported by actual implementation and appropriate testing.

**Final objective: deliver a working, private, P2P-first voice and screen-sharing desktop PoC that friends can run and use, with real audio, real screen capture, a deployable single-server signaling service, and an honest, testable E2EE implementation. Start now and make the code changes directly.**

## Başlamadan önce bilmen gerekenler

- Tek sunucu yeterli: İlk sürüm için tek bir Ubuntu VPS üzerinde sinyalleşme ve TURN çalıştırılabilir. TURN altyapısı için [coturn](https://github.com/coturn/coturn) kullanılabilir.&#x20;

  [image](https://www.google.com/s2/favicons?domain=https://coturn.github.io\&sz=32)

  GitHub

  +1

- 1080p / 60 FPS garanti değildir: Gönderen bilgisayarın performansı, ekran yakalama API'si, internet upload hızı ve alıcıların bağlantısı sonucu belirler. 30 ve 15 FPS seçenekleri gerçek yakalama ayarlarına uygulanmalı.

- E2EE konusunda taviz verme: WebRTC'nin taşıma şifrelemesi tek başına, sinyalleşme sunucusuna karşı doğrulanmış uygulama düzeyinde uçtan uca şifreleme ile aynı şey değildir. Prompt bu ayrımı özellikle şart koşuyor.

- Önce PoC'yi çalıştır: Ajanın ilk hedefi gerçek iki istemci arasında sesli görüşme olmalı; sonra ekran paylaşımı, TURN ve doğrulanmış E2EE tamamlanmalı.

Benim tercihim: İlk dağıtımda Railway veya Render yerine UDP portlarını kontrol edebildiğin tek bir VPS kullan. Böylece gerçek P2P bağlantısını ve bağlantı kurulamadığında TURN yedeğini aynı ortamda test edebilirsin.