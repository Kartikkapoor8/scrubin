# doctor.ps1 -- ScrubIn machine health check (build / test / deploy laptop)
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\doctor.ps1
#          (re-run any time something breaks; it changes nothing, only reports)
#
# Checks Windows build (and Windows Mixed Reality removal in 24H2+), disk, RAM, GPU, winget/git/lfs/gh,
# Unity Hub + editors (+UWP module), Visual Studio workloads, MSBuild, Windows SDKs, WinAppDeployCmd,
# LongPathsEnabled, network profile, power plan, and, if HOLOLENS_IP is set (env or tools\.env.local),
# ping + Device Portal reachability. Credentials are never printed.
# Exit code = number of blocking failures (0 = ready).

param([string]$Repo = 'C:\dev\scrubin')

. "$PSScriptRoot\_common.ps1"
$ErrorActionPreference = 'Continue'
Import-ScrubInEnv
# Pick up tools installed since this terminal opened.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$fail = 0
function Bad($n, $d) { Write-Check bad $n $d; $script:fail++ }

Write-Host ''
Write-Host '=== ScrubIn doctor ===' -ForegroundColor Cyan
Write-Host ('{0}  on {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $env:COMPUTERNAME) -ForegroundColor DarkGray

# ---------------- System ----------------
Write-Host "`n[System]" -ForegroundColor Cyan
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$build = [int]$cv.CurrentBuild
$osName = if ($build -ge 22000) { $cv.ProductName -replace 'Windows 10', 'Windows 11' } else { $cv.ProductName }
$osDetail = '{0} {1} (build {2}.{3})' -f $osName, $cv.DisplayVersion, $build, $cv.UBR
if ($build -ge 26100) {
    Write-Check warn 'Windows' "$osDetail -- 24H2+: Windows Mixed Reality REMOVED. HL1 remoting may fail; UWP deploy = primary path"
} else { Write-Check ok 'Windows' $osDetail }

$drive = Get-PSDrive C
$freeGB = [math]::Round($drive.Free / 1GB, 1)
if ($freeGB -ge 40) { Write-Check ok 'Free disk (C:)' "$freeGB GB" } else { Bad 'Free disk (C:)' "$freeGB GB (need ~40 GB)" }

$cs = Get-CimInstance Win32_ComputerSystem
$ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
if ($ramGB -ge 8) { Write-Check ok 'RAM' "$ramGB GB" } else { Write-Check warn 'RAM' "$ramGB GB (8+ recommended)" }

foreach ($g in Get-CimInstance Win32_VideoController) {
    Write-Check info 'GPU' ('{0} (driver {1})' -f $g.Name, $g.DriverVersion)
}

$plan = (powercfg /getactivescheme) 2>$null
if ($plan -match '\((.+)\)') { $planName = $Matches[1] } else { $planName = "$plan" }
if ($planName -match 'High performance|Ultimate') { Write-Check ok 'Power plan' $planName }
else { Write-Check warn 'Power plan' "$planName (use High performance for demo)" }

# ---------------- Tools ----------------
Write-Host "`n[Tools]" -ForegroundColor Cyan
function Ver($cmd, $args2) { try { (& $cmd @args2 2>$null | Select-Object -First 1) } catch { $null } }

if (Get-Command winget -ErrorAction SilentlyContinue) { Write-Check ok 'winget' (Ver winget @('--version')) } else { Bad 'winget' 'missing' }
if (Get-Command git -ErrorAction SilentlyContinue) { Write-Check ok 'git' (Ver git @('--version')) } else { Bad 'git' 'missing' }
$lfs = Ver git @('lfs', 'version')
if ($lfs) {
    $hooked = (git config --global --get filter.lfs.process) 2>$null
    if ($hooked) { Write-Check ok 'git-lfs' $lfs } else { Write-Check warn 'git-lfs' "$lfs (run: git lfs install)" }
} else { Bad 'git-lfs' 'missing' }
if (Get-Command gh -ErrorAction SilentlyContinue) {
    $null = gh auth status 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Check ok 'gh' ((Ver gh @('--version')) + ' -- authenticated') }
    else { Bad 'gh' ((Ver gh @('--version')) + ' -- NOT logged in (run: gh auth login)') }
} else { Bad 'gh' 'missing' }

# ---------------- Unity ----------------
Write-Host "`n[Unity]" -ForegroundColor Cyan
$hubExe = @("$env:ProgramFiles\Unity Hub\Unity Hub.exe", "${env:ProgramFiles(x86)}\Unity Hub\Unity Hub.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$hubPkg = Get-AppxPackage -Name 'UnityTechnologies.UnityHub' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($hubPkg) { Write-Check ok 'Unity Hub' ("$($hubPkg.Version) (app package)") }
elseif ($hubExe) { Write-Check ok 'Unity Hub' ((Get-Item $hubExe).VersionInfo.ProductVersion) }
else { Bad 'Unity Hub' 'missing' }

$wantVer = $null
$pv = Join-Path $Repo 'ProjectSettings\ProjectVersion.txt'
if (Test-Path $pv) { $m = Select-String -Path $pv -Pattern 'm_EditorVersion:\s*(\S+)'; if ($m) { $wantVer = $m.Matches[0].Groups[1].Value } }

$editorRoots = @("$env:ProgramFiles\Unity\Hub\Editor")
$sec = Join-Path $env:APPDATA 'UnityHub\secondaryInstallPath.json'
if (Test-Path $sec) { $p = (Get-Content $sec -Raw).Trim().Trim('"'); if ($p) { $editorRoots += $p } }
$editors = @()
foreach ($r in $editorRoots | Select-Object -Unique) {
    if (Test-Path $r) {
        foreach ($d in Get-ChildItem $r -Directory) {
            if (Test-Path (Join-Path $d.FullName 'Editor\Unity.exe')) { $editors += $d }
        }
    }
}
if ($editors.Count -eq 0) { Bad 'Unity editors' 'none installed' }
foreach ($e in $editors) {
    $uwp = Test-Path (Join-Path $e.FullName 'Editor\Data\PlaybackEngines\MetroSupport')
    $tag = if ($uwp) { 'UWP module installed' } else { 'NO UWP module' }
    $st = if ($uwp) { 'ok' } else { 'warn' }
    Write-Check $st ('Unity ' + $e.Name) ("$tag -- $($e.FullName)")
}
if ($wantVer) {
    $hit = $editors | Where-Object { $_.Name -eq $wantVer }
    if ($hit -and (Test-Path (Join-Path $hit.FullName 'Editor\Data\PlaybackEngines\MetroSupport'))) { Write-Check ok 'Project editor version' "$wantVer present with UWP" }
    else { Bad 'Project editor version' "$wantVer (from ProjectVersion.txt) not installed with UWP" }
} else { Write-Check info 'Project editor version' "repo not found at $Repo (yet)" }
$running = Get-Process Unity -ErrorAction SilentlyContinue
if ($running) { Write-Check info 'Unity Editor running' ("PID " + ($running.Id -join ',') + ' (close it before tools\build.ps1)') }

# ---------------- Visual Studio / SDK ----------------
Write-Host "`n[Visual Studio / Windows SDK]" -ForegroundColor Cyan
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$msbuild = $null
if (Test-Path $vswhere) {
    $all = & $vswhere -all -prerelease -products * -format json | ConvertFrom-Json
    if (-not $all) { Bad 'Visual Studio' 'installer present, no instances' }
    # Unity's IL2CPP UWP output is a C++ project: what matters is the C++ UWP tools + an MSVC toolset.
    $full = & $vswhere -all -prerelease -products * -format json -include packages | ConvertFrom-Json
    $goodVs = $false
    foreach ($i in $full) {
        $ids = @($i.packages | ForEach-Object { $_.id })
        $cppUwp = ($ids -contains 'Microsoft.VisualStudio.ComponentGroup.UWP.VC') -or ($ids -contains 'Microsoft.VisualStudio.ComponentGroup.UWP.VC.BuildTools')
        $uwp    = ($ids -contains 'Microsoft.VisualStudio.Workload.Universal') -or ($ids -contains 'Microsoft.VisualStudio.Workload.UniversalBuildTools')
        $game   = $ids -contains 'Microsoft.VisualStudio.Workload.ManagedGame'
        $major  = ([version]$i.installationVersion).Major
        $tags = @()
        $tags += $(if ($uwp) { 'UWP' } else { 'no UWP workload' })
        $tags += $(if ($cppUwp) { 'C++ UWP tools' } else { 'NO C++ UWP tools' })
        if ($game) { $tags += 'Unity tools' }
        $note = switch ($major) { 16 { 'matches Unity 2019.4' } 17 { 'OK, may need toolset retarget' } default { 'too new/old for Unity 2019.4 IL2CPP' } }
        $usable = $uwp -and $cppUwp -and ($major -in 16, 17)
        if ($usable) { $goodVs = $true }
        $st = if ($usable) { 'ok' } else { 'warn' }
        Write-Check $st $i.displayName ("{0} [{1}] {2}" -f $i.installationVersion, ($tags -join ', '), $note)
    }
    if (-not $goodVs) { Bad 'VS usable for HoloLens build' 'need VS 2019 (or 2022) with UWP + C++ UWP tools' }
    # Prefer VS 2019 (16.x), then 2022 (17.x) MSBuild: the one build.ps1 will use.
    $msbuild = & $vswhere -products * -version '[16.0,18.0)' -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Sort-Object | Select-Object -First 1
    if (-not $msbuild) { $msbuild = & $vswhere -latest -prerelease -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1 }
} else { Bad 'Visual Studio' 'not installed' }
if ($msbuild) { Write-Check ok 'MSBuild' $msbuild } else { Bad 'MSBuild' 'not found' }

$kits = "${env:ProgramFiles(x86)}\Windows Kits\10"
$sdks = @()
if (Test-Path "$kits\Include") { $sdks = Get-ChildItem "$kits\Include" -Directory | Where-Object { $_.Name -match '^10\.0\.\d+\.\d+$' -and (Test-Path "$kits\Platforms\UAP\$($_.Name)") } | ForEach-Object { $_.Name } }
$goodSdk = $sdks | Where-Object { ([version]$_) -ge [version]'10.0.18362.0' }
if ($goodSdk) { Write-Check ok 'Windows 10/11 SDK (UAP)' ($sdks -join ', ') } else { Bad 'Windows 10/11 SDK (UAP)' ("need >= 10.0.18362; found: " + ($(if ($sdks) { $sdks -join ', ' } else { 'none' }))) }

$wadc = Get-ChildItem "$kits\bin" -Recurse -Filter WinAppDeployCmd.exe -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if ($wadc) { Write-Check ok 'WinAppDeployCmd' $wadc.FullName } else { Write-Check warn 'WinAppDeployCmd' 'not found (fallback deploy only; REST path does not need it)' }

$lp = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction SilentlyContinue).LongPathsEnabled
if ($lp -eq 1) { Write-Check ok 'LongPathsEnabled' '1' } else { Bad 'LongPathsEnabled' "$lp (needs 1; UWP builds break past 260 chars)" }

# ---------------- Network ----------------
Write-Host "`n[Network]" -ForegroundColor Cyan
$profiles = Get-NetConnectionProfile -ErrorAction SilentlyContinue
foreach ($np in $profiles) {
    $ip = (Get-NetIPAddress -InterfaceIndex $np.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
    $st = if ($np.NetworkCategory -eq 'Public') { 'warn' } else { 'ok' }
    Write-Check $st ('Adapter: ' + $np.InterfaceAlias) ("{0}  ip {1}  network '{2}'  profile {3}" -f $np.IPv4Connectivity, $ip, $np.Name, $np.NetworkCategory)
}
if (-not $profiles) { Write-Check warn 'Network' 'no connected profile' }
$hs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '192.168.137.*' }
if ($hs) { Write-Check ok 'Mobile hotspot' ("ON -- laptop is {0} on '{1}'" -f $hs.IPAddress, $hs.InterfaceAlias) }
else { Write-Check info 'Mobile hotspot' 'off (Settings > Network & internet > Mobile hotspot)' }

# ---------------- HoloLens ----------------
Write-Host "`n[HoloLens]" -ForegroundColor Cyan
if ($env:HOLOLENS_IP) {
    $ipH = ($env:HOLOLENS_IP -split ':')[0]
    $base = Get-DPBase
    $pings = Test-Connection -ComputerName $ipH -Count 4 -ErrorAction SilentlyContinue
    if ($pings) {
        $avg = [math]::Round((($pings | Measure-Object ResponseTime -Average).Average), 1)
        Write-Check ok "Ping $ipH" ("{0}/4 replies, avg {1} ms" -f @($pings).Count, $avg)
    } else { Bad "Ping $ipH" 'no reply (same network? device awake? client isolation?)' }
    try {
        $r = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 8
        Write-Check ok 'Device Portal' "$base responds ($($r.StatusCode))"
    } catch {
        $code = $null; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        if ($code) { Write-Check ok 'Device Portal' "$base responds ($code, auth required)" }
        else { Bad 'Device Portal' ("$base unreachable: " + $_.Exception.Message) }
    }
    if ($env:HOLOLENS_USER -and $env:HOLOLENS_PASS) {
        try { $info = Invoke-DP -Path '/api/os/info'; Write-Check ok 'Device Portal login' ("OK -- {0} {1}" -f $info.ComputerName, $info.OsVersion) }
        catch { Bad 'Device Portal login' ('failed: ' + $_.Exception.Message) }
        try { $b = Invoke-DP -Path '/api/power/battery'; Write-Check info 'HoloLens battery' ("{0}%  charging={1}" -f [math]::Round(100 * $b.RemainingCapacity / [math]::Max(1, $b.MaximumCapacity)), $b.Charging) } catch {}
    } else { Write-Check info 'Device Portal login' 'HOLOLENS_USER/HOLOLENS_PASS not set (needed for deploy/record)' }
} else { Write-Check info 'HOLOLENS_IP' 'not set (env var or tools\.env.local)' }

Write-Host ''
if ($fail -eq 0) { Write-Host "READY: 0 blocking failures." -ForegroundColor Green }
else { Write-Host "$fail blocking failure(s) above." -ForegroundColor Red }
exit $fail
