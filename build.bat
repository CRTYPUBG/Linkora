@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo         LINKORA WINDOWS BUILD ^& SIGN AUTOMATION
echo ============================================================
echo.

python --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [*] Python tespit edildi. build.py baslatiliyor...
    python "%~dp0build.py"
    if %ERRORLEVEL% NEQ 0 (
        echo [!] build.py basarisiz oldu.
        pause
        exit /b 1
    )
) else (
    echo [*] Python bulunamadi, dogrudan Tauri ve PowerShell imzalama calistiriliyor...
    
    cd /d "%~dp0"
    call npm run build:shared
    call npm run build:crypto
    call npm --workspace=apps/desktop run build
    call npm --workspace=apps/desktop run tauri build
    
    echo [*] Dijital imza basiliyor...
    powershell -ExecutionPolicy Bypass -Command "$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Linkora Communications LLC' -CertStoreLocation 'Cert:\CurrentUser\My'; $target = 'apps\desktop\src-tauri\target\release\linkora.exe'; if (Test-Path $target) { Set-AuthenticodeSignature -FilePath $target -Certificate $cert; Copy-Item $target -Destination 'Linkora.exe' -Force; Write-Host '[OK] Linkora.exe imzalandi ve kok dizine kopyalandi!' }"
)

echo.
echo ============================================================
echo  ISLEM TAMAMLANDI! 
echo  Ana dizindeki Linkora.exe dosyasini arkadasina atabilirsin.
echo ============================================================
pause
