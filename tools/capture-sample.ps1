# capture-sample.ps1 -- grab samples for the Mac session: 10 s of the raw MRC live stream + one MRC photo.
#
# Usage:   tools\run capture-sample [-Seconds 10] [-PhotoOnly] [-StreamOnly]
# Writes (repo root, committed for the Mac session):
#   captures\mrc-live-sample.mp4         raw bytes of the same stream the Mac relay reads:
#                                         /api/holographic/stream/live_high.mp4?holo=true&pv=true&mic=false&loopback=false
#   captures\mrc-photo-<time>.jpg         a Mixed Reality Capture photo (holograms + camera)
# The stream is closed when the time is up; no viewer is left running (the headset serves one at a time).
# Needs HOLOLENS_IP / HOLOLENS_USER / HOLOLENS_PASS (env or tools\.env.local). Never prints credentials.

param([int]$Seconds = 10, [switch]$PhotoOnly, [switch]$StreamOnly)

. "$PSScriptRoot\_common.ps1"
Import-ScrubInEnv
$base = Get-DPBase
$cred = Get-DPCredential
$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'captures'
New-Item -ItemType Directory -Force $outDir | Out-Null

if (-not $PhotoOnly) {
    $path = '/api/holographic/stream/live_high.mp4?holo=true&pv=true&mic=false&loopback=false'
    $out = Join-Path $outDir 'mrc-live-sample.mp4'
    Write-Host "Recording $Seconds s of the live stream (same URL + params as vision/server/relay.mjs)..." -ForegroundColor Cyan
    $req = [Net.HttpWebRequest]::Create("$base$path")
    $req.Credentials = $cred.GetNetworkCredential()
    $req.PreAuthenticate = $true
    $req.Timeout = 15000
    $req.ReadWriteTimeout = 15000
    $resp = $null; $fs = $null; $total = 0
    try {
        $resp = $req.GetResponse()
        $s = $resp.GetResponseStream()
        $fs = [IO.File]::Create($out)
        $buf = New-Object byte[] 65536
        $sw = [Diagnostics.Stopwatch]::StartNew()
        while ($sw.Elapsed.TotalSeconds -lt $Seconds) {
            $n = $s.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            $fs.Write($buf, 0, $n); $total += $n
        }
    } finally {
        if ($fs) { $fs.Close() }
        if ($resp) { $resp.Close() }   # closes the stream: the Mac can connect again
    }
    Write-Check $(if ($total -gt 100KB) { 'ok' } else { 'warn' }) 'Live stream sample' ("{0:N1} MB -> {1}" -f ($total / 1MB), $out)
}

if (-not $StreamOnly) {
    $before = @((Invoke-DP -Path '/api/holographic/mrc/files').MrcRecordings | ForEach-Object { $_.FileName })
    $null = Invoke-DP -Method POST -Path '/api/holographic/mrc/photo' -Query @{ holo = 'true'; pv = 'true' }
    $photo = $null
    $deadline = (Get-Date).AddSeconds(20)
    while (-not $photo -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
        $photo = (Invoke-DP -Path '/api/holographic/mrc/files').MrcRecordings |
                 Where-Object { $_.FileName -like '*.jpg' -and $before -notcontains $_.FileName } | Select-Object -First 1
    }
    if (-not $photo) { throw 'The MRC photo did not appear within 20 s.' }
    $out = Join-Path $outDir ('mrc-photo-{0:yyyyMMdd_HHmmss}.jpg' -f (Get-Date))
    Invoke-DP -Path '/api/holographic/mrc/file' -Query @{ filename = (ConvertTo-Hex64 $photo.FileName); op = 'stream' } -OutFile $out
    Write-Check ok 'MRC photo' $out
}
