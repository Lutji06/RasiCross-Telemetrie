Write-Host '============================================================'
Write-Host '  RasiCross Telemetry - EXE Builder'
Write-Host '============================================================'
Write-Host ''

Write-Host '[1/5] Pruefe Node.js...'
$nodeVer = node -v 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host '[FEHLER] Node.js nicht gefunden! https://nodejs.org'; Read-Host; exit 1 }
Write-Host "  OK: Node.js $nodeVer"
Write-Host ''

Write-Host '[2/5] Lade ESP32 USB-Treiber...'
if (-not (Test-Path 'drivers')) { New-Item -ItemType Directory -Path 'drivers' | Out-Null }
if (-not (Test-Path 'drivers\CP210xVCPInstaller_x64.exe')) {
    Write-Host '  CP210x Treiber wird geladen...'
    try {
        Invoke-WebRequest -Uri 'https://www.silabs.com/documents/public/software/CP210x_Windows_Drivers.zip' -OutFile 'drivers\cp210x.zip' -UseBasicParsing -TimeoutSec 60
        Expand-Archive -Path 'drivers\cp210x.zip' -DestinationPath 'drivers\cp_tmp' -Force
        $cp = Get-ChildItem -Recurse 'drivers\cp_tmp' -Filter 'CP210xVCPInstaller_x64.exe' | Select-Object -First 1
        if ($cp) { Copy-Item $cp.FullName 'drivers\CP210xVCPInstaller_x64.exe'; Write-Host '  CP210x OK.' }
        Remove-Item -Recurse -Force 'drivers\cp_tmp','drivers\cp210x.zip' -ErrorAction SilentlyContinue
    } catch { Write-Host "  CP210x Download fehlgeschlagen: $_" }
} else { Write-Host '  CP210x bereits vorhanden.' }
Write-Host ''

Write-Host '[3/5] npm install (Electron + Builder + SerialPort, ca. 350 MB)...'
& npm install
if ($LASTEXITCODE -ne 0) { Write-Host '[FEHLER] npm install fehlgeschlagen!'; Read-Host; exit 1 }
Write-Host '  OK.'
Write-Host ''

Write-Host '[4/5] Native Module fuer Electron neu bauen (electron-rebuild)...'
& npx electron-rebuild -f -w serialport
if ($LASTEXITCODE -ne 0) {
    Write-Host '  Warnung: electron-rebuild Fehler - versuche Build trotzdem...'
}
Write-Host '  OK.'
Write-Host ''

if (-not (Test-Path 'icon.ico')) {
    Write-Host '[INFO] Kein icon.ico - Standard-Icon wird verwendet.'
    & node -e "require('fs').writeFileSync('icon.ico',Buffer.alloc(0))"
}

Write-Host '[5/5] Baue Windows EXE...'
& npm run build
if ($LASTEXITCODE -ne 0) { Write-Host '[FEHLER] Build fehlgeschlagen!'; Read-Host; exit 1 }

Write-Host ''
Write-Host '============================================================'
Write-Host 'FERTIG! Dateien in dist\'
Write-Host '  Setup:    RasiCross-Telemetry-Setup.exe'
Write-Host '  Portable: RasiCross-Telemetry-Portable.exe'
Write-Host '============================================================'
Start-Process explorer.exe 'dist'
Read-Host 'Enter druecken zum Beenden'
