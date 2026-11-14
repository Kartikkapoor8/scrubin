# connect-check.ps1 -- is the HoloLens reachable for Holographic Remoting / deploy? Measures latency.
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\connect-check.ps1 [-Ip 192.168.137.x] [-Count 20]
# Default IP = HOLOLENS_IP (env or tools\.env.local). Reports: hotspot on/off, same-subnet check,
# ping min/avg/max/loss, Device Portal reachability. Remoting wants avg < ~10 ms and 0% loss.

param([string]$Ip, [int]$Count = 20)

. "$PSScriptRoot\_common.ps1"
$ErrorActionPreference = 'Continue'
Import-ScrubInEnv
if (-not $Ip) { $Ip = $env:HOLOLENS_IP }
if (-not $Ip) { throw 'Pass -Ip <address shown in the Holographic Remoting Player> or set HOLOLENS_IP (tools\run hotspot find -Save).' }
$hostPart = ($Ip -split ':')[0]   # HOLOLENS_IP may carry a port (USB fallback)
$scheme = if ($env:HOLOLENS_SCHEME) { $env:HOLOLENS_SCHEME } else { 'https' }

if ($hostPart -like '127.*') {
    Write-Check info 'Connection' 'USB cable (Device Portal over localhost); hotspot/subnet checks skipped'
} else {
    $hs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.137.*' }
    if ($hs) { Write-Check ok 'Mobile hotspot' "ON ($($hs.IPAddress))" } else { Write-Check warn 'Mobile hotspot' 'OFF (venue Wi-Fi usually blocks device-to-device traffic): tools\run hotspot on' }

    $mine = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }
    $prefix = ($hostPart -split '\.')[0..2] -join '.'
    $same = $mine | Where-Object { $_.IPAddress -like "$prefix.*" } | Select-Object -First 1
    if ($same) { Write-Check ok 'Same subnet' "$($same.IPAddress) on '$($same.InterfaceAlias)'" } else { Write-Check warn 'Same subnet' "no local address in $prefix.x -- laptop and headset on different networks?" }
}

Write-Host "  pinging $hostPart $Count times..." -ForegroundColor DarkGray
$r = Test-Connection -ComputerName $hostPart -Count $Count -ErrorAction SilentlyContinue
$got = @($r).Count
if ($got -gt 0) {
    $m = $r | Measure-Object ResponseTime -Minimum -Average -Maximum
    $loss = [math]::Round(100 * ($Count - $got) / $Count)
    $st = if ($m.Average -lt 10 -and $loss -eq 0) { 'ok' } else { 'warn' }
    Write-Check $st "Ping $hostPart" ("min/avg/max {0}/{1:N1}/{2} ms, loss {3}%" -f $m.Minimum, $m.Average, $m.Maximum, $loss)
} else { Write-Check bad "Ping $hostPart" 'no replies' }

Enable-HoloLensCert -Ip $hostPart
try { $null = Invoke-WebRequest "${scheme}://$Ip/" -UseBasicParsing -TimeoutSec 6; Write-Check ok 'Device Portal' 'reachable' }
catch { if ($_.Exception.Response) { Write-Check ok 'Device Portal' 'reachable (login required)' } else { Write-Check warn 'Device Portal' 'not reachable (enable it on the headset: Settings > Update & Security > For developers)' } }
