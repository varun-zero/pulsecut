# One-click launcher for the PulseCut local website.
# Starts the Rust backend (dashboard + API on 8756) and the React frontend (3000),
# then opens http://127.0.0.1:3000/ in your browser.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$env:PULSECUT_FFMPEG = "C:\Users\varun\AppData\Local\Programs\YIZERGE\ffmpeg.exe"
$env:PULSECUT_WHISPER = Join-Path $root 'automation\whisper-cli.cmd'
$env:PULSECUT_WHISPER_MODEL = 'small.en'
$env:PULSECUT_FFPROBE = 'C:\Users\varun\AppData\Local\Programs\YIZERGE\ffprobe.exe'
$env:PULSECUT_API_URL = "http://127.0.0.1:8756"
$env:PATH = "C:\Users\varun\AppData\Local\Programs\YIZERGE;$env:PATH"

function Test-Port($p) {
    return [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

# --- Backend on 8756 ---
if (-not (Test-Port 8756)) {
    Write-Host "Starting PulseCut backend on 127.0.0.1:8756 ..."
    $bin = Join-Path $root "target\release\pulsecut.exe"
    if (-not (Test-Path $bin)) { throw "Backend binary missing: $bin (run cargo build --release -p pulsecut)" }
    Start-Process -FilePath $bin `
        -ArgumentList @("editor", "--addr", "127.0.0.1:8756") `
        -WorkingDirectory $root -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 20; $i++) {
        if (Test-Port 8756) { break }
        Start-Sleep -Milliseconds 500
    }
}
Write-Host "Backend: $(if (Test-Port 8756) {'OK'} else {'FAILED'})"

# --- Frontend on 3000 ---
if (-not (Test-Port 3000)) {
    if (-not (Test-Path (Join-Path $root "node_modules"))) { throw "node_modules missing (run npm install)" }
    Write-Host "Starting React frontend on 127.0.0.1:3000 ..."
    Start-Process -FilePath "npm" -ArgumentList @("run", "dev") `
        -WorkingDirectory $root -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        if (Test-Port 3000) { break }
        Start-Sleep -Milliseconds 500
    }
}
Write-Host "Frontend: $(if (Test-Port 3000) {'OK'} else {'FAILED'})"

Start-Process "http://127.0.0.1:3000/"
Write-Host "Opened http://127.0.0.1:3000/  (backend API: http://127.0.0.1:8756/)"

