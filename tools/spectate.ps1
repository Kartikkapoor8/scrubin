# spectate.ps1 -- show what the HoloLens wearer sees (holograms + camera) full-screen on this laptop.
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\spectate.ps1 [-Quality high|med|low] [-NoAudio]
# Opens the Device Portal Mixed Reality Capture live stream in Microsoft Edge, full screen (F11 to exit).
# First time per browser session: Edge shows a certificate warning (click Advanced > Continue) and a
# sign-in box. Kartik types the Device Portal credentials there himself. Do this BEFORE judges arrive.
# Expect a delay of a few seconds: the stream is a chunked fragmented MP4, buffered by the browser.
# Endpoint: GET https://<ip>/api/holographic/stream/live_<q>.mp4?holo=true&pv=true&mic=..&loopback=..

param([ValidateSet('high', 'med', 'low')][string]$Quality = 'high', [switch]$NoAudio)

. "$PSScriptRoot\_common.ps1"
Import-ScrubInEnv
if (-not $env:HOLOLENS_IP) { throw 'HOLOLENS_IP not set (tools\.env.local or your shell).' }
$audio = if ($NoAudio) { 'false' } else { 'true' }
# mic=false by default: the laptop speakers + wearer mic would echo in a demo room.
$url = (Get-DPBase) + "/api/holographic/stream/live_$Quality.mp4?holo=true&pv=true&mic=false&loopback=$audio"
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process $edge -ArgumentList @('--new-window', '--start-fullscreen', $url) }
else { Start-Process $url }
Write-Host "Opened live stream ($Quality). F11 leaves full screen. If it stalls, refresh (F5)." -ForegroundColor Green
