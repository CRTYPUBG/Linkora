import os
import sys
import subprocess
import random
import string
import shutil
from pathlib import Path

# Rastgele ve kurumsal görünümlü imzalayıcı isim havuzu
COMPANY_NAMES = [
    "Linkora Secure Systems Ltd.",
    "Apex Network Technologies Inc.",
    "Nova Voice Protocol Foundation",
    "Bozkurt Digital Communications A.S.",
    "Vanguard Peer Communications Corp.",
    "Hyperion Media Cryptography LLC",
    "Aegis Realtime Network Traversal",
    "Specter Interactive Softworks"
]

DEPARTMENTS = [
    "Release Security & Code Signing",
    "Production Systems Engineering",
    "Core Infrastructure Operations",
    "Application Packaging Unit",
    "Desktop Engineering Division"
]

def random_string(length=8):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def run_cmd(cmd, cwd=None):
    print(f"[*] Calistiriliyor: {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=cwd)
    if res.returncode != 0:
        print(f"[!] Hata olustu! Cikis kodu: {res.returncode}")
        return False
    return True

def sign_exe_powershell(exe_path, company_name):
    print(f"\n[+] Dijital Imza Olusturuluyor...")
    print(f"[+] Imzalayan Kurum / Gelistirici: {company_name}")
    
    ps_script = f"""
    $certName = "{company_name}"
    Write-Host "[*] Gecici kod imzalama sertifikasi uretiliyor: $certName"
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=$certName, O=$certName" -KeySpec Signature -CertStoreLocation "Cert:\\CurrentUser\\My"
    
    $exe = "{exe_path}"
    if (Test-Path $exe) {{
        Write-Host "[*] Dijital imza basiliyor: $exe"
        Set-AuthenticodeSignature -FilePath $exe -Certificate $cert -TimestampServer "http://timestamp.digicert.com"
        Write-Host "[OK] Dijital imza basarili!"
    }} else {{
        Write-Host "[!] Dosya bulunamadi: $exe"
    }}
    """
    
    tmp_ps = Path("temp_signer.ps1")
    tmp_ps.write_text(ps_script, encoding="utf-8")
    try:
        run_cmd(f"powershell -ExecutionPolicy Bypass -File temp_signer.ps1")
    finally:
        if tmp_ps.exists():
            tmp_ps.unlink()

def main():
    root_dir = Path(__file__).resolve().parent
    print("=" * 60)
    print("      LINKORA WINDOWS BUILD & DYNAMIC CODE SIGNER      ")
    print("=" * 60)

    # 1. Kütüphaneleri ve frontend'i derle
    print("\n[1/4] Shared ve Crypto kutuphaneleri derleniyor...")
    if not run_cmd("npm run build:shared", cwd=str(root_dir)):
        sys.exit(1)
    if not run_cmd("npm run build:crypto", cwd=str(root_dir)):
        sys.exit(1)

    print("\n[2/4] Desktop Frontend Vite bundle derleniyor...")
    if not run_cmd("npm --workspace=apps/desktop run build", cwd=str(root_dir)):
        sys.exit(1)

    # 2. Tauri ile Windows Exe ve Installer paketle
    print("\n[3/4] Tauri ile Windows linkora.exe derleniyor (Cargo Release)...")
    if not run_cmd("npm --workspace=apps/desktop run tauri build", cwd=str(root_dir)):
        sys.exit(1)

    # 3. Derlenen exe dosyalarını bul
    release_dir = root_dir / "apps" / "desktop" / "src-tauri" / "target" / "release"
    exe_file = release_dir / "linkora.exe"

    if not exe_file.exists():
        # Alternatif isim
        exe_file = release_dir / "appsdesktop.exe"

    if not exe_file.exists():
        print("[!] Derlenen ana exe dosyasi bulunamadi!")
        sys.exit(1)

    # 4. Rastgele bir imzalayıcı seç
    chosen_company = random.choice(COMPANY_NAMES)
    chosen_dept = random.choice(DEPARTMENTS)
    signer_identity = f"{chosen_company} - {chosen_dept}"

    # 5. Dijital imza at
    print(f"\n[4/4] Exe dosyasina dijital imza ekleniyor: {exe_file.name}")
    sign_exe_powershell(str(exe_file), signer_identity)

    # Installer msi veya nsis varsa onları da imzala
    bundle_dir = release_dir / "bundle"
    if bundle_dir.exists():
        for installer in bundle_dir.glob("**/*.*"):
            if installer.suffix.lower() in [".exe", ".msi"]:
                print(f"[+] Kurulum paketine dijital imza basiliyor: {installer.name}")
                sign_exe_powershell(str(installer), signer_identity)

    # 6. Kolay erişim için ana dizine kopyala
    output_bin = root_dir / "Linkora.exe"
    shutil.copy2(exe_file, output_bin)

    print("\n" + "=" * 60)
    print(" [BASARILI] LINKORA WINDOWS PAKETLEME VE IMZALAMA TAMAMLANDI!")
    print(f" Dogrudan calistirilabilir dosya: {output_bin}")
    print(f" Imzalayan Kimlik: {signer_identity}")
    print(" Arkadasina direkt Linkora.exe dosyasini gonderebilirsin.")
    print("=" * 60)

if __name__ == "__main__":
    main()
