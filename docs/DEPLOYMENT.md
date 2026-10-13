# Linkora Single-Server VPS Deployment Guide

## Prerequisites
- An Ubuntu 22.04 or 24.04 LTS VPS with a dedicated public IPv4 address.
- Docker and Docker Compose installed.

## Firewall Configuration (UFW)
Linkora requires signaling and TURN UDP ports to be open:
```bash
sudo ufw allow 22/tcp          # SSH
sudo ufw allow 4000/tcp        # Linkora Signaling WebSocket API
sudo ufw allow 3478/tcp        # STUN/TURN TCP
sudo ufw allow 3478/udp        # STUN/TURN UDP
sudo ufw allow 49152:65535/udp # TURN Media Relay UDP Ports
sudo ufw reload
```

## Setup & Running with Docker Compose
1. Clone this repository onto your VPS:
   ```bash
   git clone <repo-url> linkora
   cd linkora
   ```
2. Copy environment template:
   ```bash
   cp .env.example .env
   ```
3. Edit `.env` with your server public IP:
   ```ini
   EXTERNAL_IP=203.0.113.10
   TURN_SECRET=your_super_secret_string
   ```
4. Start all services in the background:
   ```bash
   docker compose up -d --build
   ```
5. Check health:
   ```bash
   curl http://localhost:4000/health
   ```
