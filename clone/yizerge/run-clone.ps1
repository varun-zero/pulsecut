# Launcher for the YIZERGE reconstruction clone.
# Starts the self-contained Node static server and opens the app.
$ErrorActionPreference = "Stop"
$appDir = Join-Path $PSScriptRoot "app"
$server = Join-Path $appDir "server.mjs"

if (-not (Test-Path $server)) { throw "Missing server: $server" }

Write-Host "Starting YIZERGE clone on http://127.0.0.1:8892/ ..."
Write-Host "Press Ctrl+C to stop the server."

# Start server in a new PowerShell window so Ctrl+C is clean, then open browser.
Start-Process -FilePath "powershell" `
  -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "cd '$appDir'; node server.mjs" `
  -WindowStyle Normal

Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:8892/"
