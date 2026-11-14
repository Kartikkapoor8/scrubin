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

# Note: HoloLens limits a single MRC video to about 5 minutes; record the demo in shorter takes.

param([Parameter(Mandatory)][ValidateSet('start', 'stop', 'status')][string]$Action)

. "$PSScriptRoot\_common.ps1"
Import-ScrubInEnv

# CreationTime may come back as a number (FILETIME) or a date string depending on the OS build.
function Get-SortKey($v) {
    $d = 0.0
    if ([double]::TryParse([string]$v, [ref]$d)) { return $d }
    try { return ([datetime]$v).Ticks } catch { return 0 }
}

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
        # Remember what's already on the device, so we download the NEW file, not a previous one.
        $before = @((Invoke-DP -Path '/api/holographic/mrc/files').MrcRecordings | ForEach-Object { $_.FileName })
        $null = Invoke-DP -Method POST -Path '/api/holographic/mrc/video/control/stop'
        Write-Host -NoNewline 'Stopped. Waiting for the device to save the file' -ForegroundColor Cyan
        $newest = $null
        $deadline = (Get-Date).AddSeconds(60)   # long recordings take a while to finalize
        while (-not $newest -and (Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 2
            Write-Host -NoNewline '.'
            $new = (Invoke-DP -Path '/api/holographic/mrc/files').MrcRecordings |
                   Where-Object { $_.FileName -like '*.mp4' -and $before -notcontains $_.FileName }
            $newest = $new | Sort-Object { Get-SortKey $_.CreationTime } -Descending | Select-Object -First 1
        }
        Write-Host ''
        if (-not $newest) { throw 'No new .mp4 appeared on the device within 60 s. Check Device Portal > Mixed Reality Capture.' }
        $outDir = Join-Path $PSScriptRoot 'captures'
        New-Item -ItemType Directory -Force $outDir | Out-Null
        $out = Join-Path $outDir ('scrubin_{0:yyyyMMdd_HHmmss}.mp4' -f (Get-Date))
        Write-Host "Downloading $($newest.FileName) ($([math]::Round($newest.FileSize / 1MB, 1)) MB)..."
        Invoke-DP -Path '/api/holographic/mrc/file' -Query @{ filename = (ConvertTo-Hex64 $newest.FileName); op = 'stream' } -OutFile $out -TimeoutSec 600
        Write-Host "SAVED: $out" -ForegroundColor Green
    }
}
