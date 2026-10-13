Write-Host "=== Starting Linkora Local Development Environment ===" -ForegroundColor Cyan

# 1. Build shared and crypto packages
Write-Host "Building shared libraries..." -ForegroundColor Yellow
npm run build:shared
npm run build:crypto

# 2. Launch Signaling Server in a separate job
Write-Host "Starting Signaling Server on ws://127.0.0.1:4000/ws..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\..'; npm run dev:server"

# 3. Launch Tauri 2 Desktop App
Write-Host "Launching Tauri Desktop Application..." -ForegroundColor Green
npm --workspace=apps/desktop run tauri dev
