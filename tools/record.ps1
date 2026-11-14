# record.ps1 -- start/stop a Mixed Reality Capture video on the HoloLens and download it.
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\record.ps1 start
#          powershell -ExecutionPolicy Bypass -File tools\record.ps1 stop     (downloads to tools\captures\)
#          powershell -ExecutionPolicy Bypass -File tools\record.ps1 status
# Captures holograms + PV camera + mic + app audio. Needs HOLOLENS_IP/USER/PASS (env or tools\.env.local).
# Endpoints (Microsoft Device Portal API reference):
#   POST /api/holographic/mrc/video/control/start?holo=true&pv=true&mic=true&loopback=true
#   POST /api/holographic/mrc/video/control/stop
#   GET  /api/holographic/mrc/status            {"IsRecording": bool}
#   GET  /api/holographic/mrc/files             list
#   GET  /api/holographic/mrc/file?filename=<hex64>&op=stream   download

param([Parameter(Mandatory)][ValidateSet('start', 'stop', 'status')][string]$Action)

. "$PSScriptRoot\_common.ps1"
Import-ScrubInEnv

switch ($Action) {
    'status' {
        $s = Invoke-DP -Path '/api/holographic/mrc/status'
        Write-Host "Recording: $($s.IsRecording)"
    }
    'start' {
        $null = Invoke-DP -Method POST -Path '/api/holographic/mrc/video/control/start' -Query @{ holo = 'true'; pv = 'true'; mic = 'true'; loopback = 'true' }
        Start-Sleep -Milliseconds 800
        $s = Invoke-DP -Path '/api/holographic/mrc/status'
        if ($s.IsRecording) { Write-Host ("REC started {0:HH:mm:ss}. Stop with: tools\record.ps1 stop" -f (Get-Date)) -ForegroundColor Red }
        else { Write-Host 'Start was accepted but the device does not report recording. Is another capture running?' -ForegroundColor Yellow }
    }
    'stop' {
        $null = Invoke-DP -Method POST -Path '/api/holographic/mrc/video/control/stop'
        Write-Host 'Stopped. Waiting for the file to finalize...' -ForegroundColor Cyan
        Start-Sleep -Seconds 3
        $files = (Invoke-DP -Path '/api/holographic/mrc/files').MrcRecordings | Where-Object { $_.FileName -like '*.mp4' }
        $newest = $files | Sort-Object { [double]$_.CreationTime } -Descending | Select-Object -First 1
        if (-not $newest) { throw 'No .mp4 recordings found on the device.' }
        $outDir = Join-Path $PSScriptRoot 'captures'
        New-Item -ItemType Directory -Force $outDir | Out-Null
        $out = Join-Path $outDir ('scrubin_{0:yyyyMMdd_HHmmss}.mp4' -f (Get-Date))
        Write-Host "Downloading $($newest.FileName) ($([math]::Round($newest.FileSize / 1MB, 1)) MB)..."
        Invoke-DP -Path '/api/holographic/mrc/file' -Query @{ filename = (ConvertTo-Hex64 $newest.FileName); op = 'stream' } -OutFile $out -TimeoutSec 600
        Write-Host "SAVED: $out" -ForegroundColor Green
    }
}
