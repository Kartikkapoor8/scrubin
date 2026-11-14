# stream-check.ps1 -- does the HoloLens MRC live stream serve video? Measures time-to-first-byte and bitrate.
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\stream-check.ps1 [-Quality high|med|low] [-Seconds 10]
# Needs HOLOLENS_IP / HOLOLENS_USER / HOLOLENS_PASS (env or tools\.env.local). Never prints credentials.
# Reads the stream for N seconds and discards it (nothing saved). Glass-to-viewer DELAY is measured
# separately (clock-on-screen method, see tools\REMOTING.md); this checks reachability and throughput.

param([ValidateSet('high', 'med', 'low')][string]$Quality = 'high', [int]$Seconds = 10)

. "$PSScriptRoot\_common.ps1"
Import-ScrubInEnv
$base = Get-DPBase
$cred = Get-DPCredential
$path = "/api/holographic/stream/live_$Quality.mp4?holo=true&pv=true&mic=false&loopback=false"
Write-Host ("GET {0}{1}" -f ($base -replace '//[^/]+', '//<HOLOLENS_IP>'), $path) -ForegroundColor Cyan

$req = [Net.HttpWebRequest]::Create("$base$path")
$req.Credentials = $cred.GetNetworkCredential()
$req.PreAuthenticate = $true
$req.Timeout = 15000
$req.ReadWriteTimeout = 15000
$sw = [Diagnostics.Stopwatch]::StartNew()
try { $resp = $req.GetResponse() }
catch {
    $we = $_.Exception; if ($we.InnerException) { $we = $we.InnerException }   # unwrap PowerShell's MethodInvocationException
    $code = $null; if ($we.Response) { $code = [int]$we.Response.StatusCode }
    if ($code -eq 401) { throw 'Stream refused: wrong Device Portal user/password (tools\.env.local).' }
    throw "Stream request failed: $($we.Message)"
}
$s = $resp.GetResponseStream()
$buf = New-Object byte[] 65536
$total = [long]0
try {
    $n = $s.Read($buf, 0, $buf.Length)
    $ttfb = $sw.ElapsedMilliseconds
    $total = [long]$n
    $isMp4 = ($n -ge 8) -and ([Text.Encoding]::ASCII.GetString($buf, 4, 4) -in 'ftyp', 'moof', 'styp')
    $t0 = $sw.Elapsed.TotalSeconds
    while (($sw.Elapsed.TotalSeconds - $t0) -lt $Seconds) {
        $n = $s.Read($buf, 0, $buf.Length)
        if ($n -le 0) { break }
        $total += $n
    }
} catch {
    $resp.Close()
    throw "The stream connected but stopped sending after $([math]::Round($total / 1KB)) KB ($($_.Exception.Message)). Is another app using the camera, or the headset asleep?"
}
$elapsed = $sw.Elapsed.TotalSeconds - $t0
$resp.Close()
$mbit = [math]::Round(($total * 8 / 1e6) / [math]::Max(0.1, $elapsed), 2)

Write-Check ok 'HTTP' ("{0} {1}" -f [int]$resp.StatusCode, $resp.ContentType)
Write-Check $(if ($isMp4) { 'ok' } else { 'warn' }) 'Looks like MP4' "$isMp4"
Write-Check ok 'Time to first byte' "$ttfb ms"
Write-Check $(if ($mbit -gt 0.3) { 'ok' } else { 'warn' }) 'Throughput' ("{0} Mbit/s over {1:N1} s ({2:N1} MB)" -f $mbit, $elapsed, ($total / 1MB))
