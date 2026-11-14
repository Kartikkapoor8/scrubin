# hotspot.ps1 -- control the laptop's Windows Mobile Hotspot and find the HoloLens on it. No admin needed.
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\hotspot.ps1 [status] [-ShowPassword]
#          powershell -ExecutionPolicy Bypass -File tools\hotspot.ps1 on [-FiveGHz]
#          powershell -ExecutionPolicy Bypass -File tools\hotspot.ps1 off
#          powershell -ExecutionPolicy Bypass -File tools\hotspot.ps1 find [-Save]
#   status   on/off, network name, band, connected devices (password only with -ShowPassword, so it never
#            appears on a projector by accident)
#   on       turns the hotspot on, sharing the current internet connection (-FiveGHz asks for 5 GHz if supported)
#   find     checks every device on the hotspot (192.168.137.x, or the phone hotspot the laptop is on if that's a
#            small /24 network) for a Device Portal on port 443 = the HoloLens.
#            -Save writes HOLOLENS_IP into tools\.env.local (other lines, e.g. credentials, are left untouched).
# Uses the Windows.Networking.NetworkOperators tethering API (same as Settings > Mobile hotspot).

param(
    [ValidateSet('status', 'on', 'off', 'find')][string]$Action = 'status',
    [switch]$FiveGHz, [switch]$ShowPassword, [switch]$Save
)

. "$PSScriptRoot\_common.ps1"

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]

$asTaskOp = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asTaskAction = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Await($op, [Type]$type) {
    $task = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result
}
function AwaitAction($op) { $task = $asTaskAction.Invoke($null, @($op)); $null = $task.Wait(-1) }

function Get-TetheringManager {
    $connProfile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
    if (-not $connProfile) { throw 'No internet connection to share. Connect the laptop to Wi-Fi (or Ethernet) first.' }
    [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($connProfile)
}

function Get-HotspotClients([string]$prefix = '192.168.137', [string]$self = '192.168.137.1') {
    # Devices that have talked to the laptop on that /24 (ARP / neighbor table).
    Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -like "$prefix.*" -and $_.IPAddress -ne $self -and
                       $_.IPAddress -ne "$prefix.255" -and $_.State -ne 'Unreachable' -and
                       $_.LinkLayerAddress -and $_.LinkLayerAddress -ne 'FF-FF-FF-FF-FF-FF' } |
        Sort-Object IPAddress -Unique
}

# Which /24 to search: the laptop's own hotspot if it's on, otherwise the network the laptop is joined to
# (e.g. a phone hotspot), but only if that network is small (/24 or smaller). Never sweeps a big campus network.
function Get-SearchNet {
    $hs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.137.*' } | Select-Object -First 1
    if ($hs) { return @{ Prefix = '192.168.137'; Self = $hs.IPAddress; Name = 'laptop hotspot' } }
    $prof = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | Select-Object -First 1
    if (-not $prof) { return $null }
    $ip = Get-NetIPAddress -InterfaceIndex $prof.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $ip -or $ip.PrefixLength -lt 24) {
        Write-Host ("'{0}' is a large network (/{1}); not scanning it. Read the HoloLens IP on the headset: Settings > Network & Internet > Wi-Fi > Advanced options." -f $prof.Name, $ip.PrefixLength) -ForegroundColor Yellow
        return $null
    }
    return @{ Prefix = (($ip.IPAddress -split '\.')[0..2] -join '.'); Self = $ip.IPAddress; Name = "'$($prof.Name)'" }
}

function Show-Status($tm) {
    $state = $tm.TetheringOperationalState
    $cfg = $tm.GetCurrentAccessPointConfiguration()
    $st = if ("$state" -eq 'On') { 'ok' } else { 'warn' }
    Write-Check $st 'Mobile hotspot' "$state"
    Write-Check info 'Network name' $cfg.Ssid
    if ($ShowPassword) { Write-Check info 'Password' $cfg.Passphrase } else { Write-Check info 'Password' '(hidden; add -ShowPassword)' }
    try { Write-Check info 'Band' "$($cfg.Band)" } catch { Write-Check info 'Band' '(not reported by this Windows version)' }
    Write-Check info 'Connected devices' ("{0} of {1}" -f $tm.ClientCount, $tm.MaxClientCount)
    foreach ($c in Get-HotspotClients) { Write-Check info ('  ' + $c.IPAddress) ("MAC {0}  ({1})" -f $c.LinkLayerAddress, $c.State) }
}

switch ($Action) {
    'status' { Show-Status (Get-TetheringManager) }
    'on' {
        $tm = Get-TetheringManager
        if ($FiveGHz) {
            $cfg = $tm.GetCurrentAccessPointConfiguration()
            try {
                $five = [Windows.Networking.NetworkOperators.TetheringWiFiBand]::FiveGigahertz
                if ($cfg.IsBandSupported($five)) { $cfg.Band = $five; AwaitAction ($tm.ConfigureAccessPointAsync($cfg)); Write-Host 'Band set to 5 GHz.' -ForegroundColor Green }
                else { Write-Host '5 GHz not supported by this Wi-Fi adapter right now; keeping the current band.' -ForegroundColor Yellow }
            } catch { Write-Host "Could not set the band ($($_.Exception.Message)); keeping the current band." -ForegroundColor Yellow }
        }
        if ("$($tm.TetheringOperationalState)" -ne 'On') {
            $r = Await ($tm.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
            if ("$($r.Status)" -ne 'Success') { throw "Could not start the hotspot: $($r.Status) $($r.AdditionalErrorMessage)" }
        }
        Show-Status $tm
    }
    'off' {
        $tm = Get-TetheringManager
        $r = Await ($tm.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
        Write-Check $(if ("$($r.Status)" -eq 'Success') { 'ok' } else { 'warn' }) 'Mobile hotspot off' "$($r.Status)"
    }
    'find' {
        # Wake up the neighbor table: one ping sweep of likely addresses (Windows hands out .2-.254).
        $net = Get-SearchNet
        if (-not $net) { throw 'No small network to search. Turn on the laptop hotspot (tools\run hotspot on) or join the phone hotspot.' }
        Write-Host "Searching $($net.Name) ($($net.Prefix).x)..." -ForegroundColor DarkGray
        $clients = @(Get-HotspotClients $net.Prefix $net.Self)
        if ($clients.Count -eq 0) {
            Write-Host "No devices seen yet; sweeping $($net.Prefix).1-254 (about 10 s)..." -ForegroundColor DarkGray
            $pings = foreach ($i in 1..254) { if ("$($net.Prefix).$i" -ne $net.Self) { (New-Object Net.NetworkInformation.Ping).SendPingAsync("$($net.Prefix).$i", 300) } }
            try { [Threading.Tasks.Task]::WaitAll($pings) } catch {}
            $clients = @(Get-HotspotClients $net.Prefix $net.Self)
        }
        $found = $null
        foreach ($c in $clients) {
            $ip = $c.IPAddress
            Enable-HoloLensCert -Ip $ip
            try { $null = Invoke-WebRequest "https://$ip/" -UseBasicParsing -TimeoutSec 3; $hit = $true }
            catch { $hit = [bool]$_.Exception.Response }   # 401 = something answers HTTPS with auth = Device Portal
            Write-Check $(if ($hit) { 'ok' } else { 'info' }) $ip $(if ($hit) { 'Device Portal answers -> HoloLens' } else { 'no Device Portal' })
            if ($hit -and -not $found) { $found = $ip }
        }
        if (-not $found) { throw 'HoloLens not found on the hotspot. Is it joined to this hotspot, awake, with Device Portal on?' }
        Write-Host "HOLOLENS_IP=$found" -ForegroundColor Green
        if ($Save) {
            $envFile = Join-Path $PSScriptRoot '.env.local'
            $lines = @(); if (Test-Path $envFile) { $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch '^\s*HOLOLENS_IP\s*=' }) }
            @("HOLOLENS_IP=$found") + $lines | Set-Content $envFile -Encoding UTF8
            Write-Host "Saved HOLOLENS_IP to tools\.env.local (other lines unchanged)." -ForegroundColor Green
        }
    }
}
