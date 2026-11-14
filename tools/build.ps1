# build.ps1 -- build the HoloLens 1 app package (.appx) from the Unity project, one command.
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\build.ps1 [-SkipUnity] [-Configuration Release]
#            -SkipUnity      reuse the UWP solution already in C:\b\scrubin (e.g. after "ScrubIn/Build HoloLens (x86)")
#            -Toolset v143   force an MSVC toolset (only needed if VS 2019 is missing and VS 2022 is used)
#          Never cleans: always builds into the same C:\b\scrubin so IL2CPP + MSBuild stay incremental.
#          Bumps the package version each build so deploy.ps1 can update in place without uninstalling.
#          Delete C:\b\scrubin by hand only if a build gets into a broken state.
#
# Steps: 1) refuse if the project is open in the Unity Editor (batch mode would fail)
#        2) Unity batch mode -> ScrubIn.EditorTools.BuildScript.BuildBatch -> UWP solution in C:\b\scrubin
#        3) MSBuild Release|x86 -> sideload .appx (+ dependencies + .cer) under C:\b\scrubin\<Product>\AppPackages
# Prints the package path and total time. Unity log: C:\b\scrubin-unity.log

param(
    [string]$Repo = 'C:\dev\scrubin',
    [string]$OutDir = 'C:\b\scrubin',
    [string]$Configuration = 'Release',
    [string]$Toolset = '',
    [switch]$SkipUnity
)

. "$PSScriptRoot\_common.ps1"
$sw = [Diagnostics.Stopwatch]::StartNew()

function Find-UnityEditor {
    $ver = (Select-String -Path (Join-Path $Repo 'ProjectSettings\ProjectVersion.txt') -Pattern 'm_EditorVersion:\s*(\S+)').Matches[0].Groups[1].Value
    $roots = @("$env:ProgramFiles\Unity\Hub\Editor")
    $sec = Join-Path $env:APPDATA 'UnityHub\secondaryInstallPath.json'
    if (Test-Path $sec) { $p = (Get-Content $sec -Raw).Trim().Trim('"'); if ($p) { $roots += $p } }
    foreach ($r in $roots) { $exe = Join-Path $r "$ver\Editor\Unity.exe"; if (Test-Path $exe) { return $exe } }
    throw "Unity $ver (from ProjectVersion.txt) not found under: $($roots -join ', '). Install it via Unity Hub with UWP Build Support."
}

function Test-ProjectOpen {
    $lock = Join-Path $Repo 'Temp\UnityLockfile'
    if (-not (Test-Path $lock)) { return $false }
    try { $fs = [IO.File]::Open($lock, 'Open', 'ReadWrite', 'None'); $fs.Close(); return $false } catch { return $true }
}

function Find-MSBuild {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    $m = & $vswhere -products * -version '[16.0,17.0)' -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
    # Always force the toolset that matches this MSBuild: Unity's "Latest installed" can pick v143 when a newer
    # VS (e.g. 2026 Build Tools) is also present, and VS 2019 cannot build v143.
    if ($m) { return @{ Path = $m; Toolset = 'v142' } }
    $m = & $vswhere -products * -version '[17.0,18.0)' -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
    if ($m) { return @{ Path = $m; Toolset = 'v143' } }
    throw 'No VS 2019/2022 MSBuild found. Run tools\doctor.ps1.'
}

# ---- 1+2: Unity -> UWP solution
if (-not $SkipUnity) {
    if (Test-ProjectOpen) { throw "The project is open in the Unity Editor. Close Unity (File > Exit) and re-run, or use the menu 'ScrubIn/Build HoloLens (x86)' then: tools\build.ps1 -SkipUnity" }
    $unity = Find-UnityEditor
    $log = Join-Path (Split-Path $OutDir -Parent) 'scrubin-unity.log'
    New-Item -ItemType Directory -Force (Split-Path $OutDir -Parent) | Out-Null
    Write-Host "[1/2] Unity batch build -> $OutDir  (log: $log)" -ForegroundColor Cyan
    $args1 = @('-batchmode', '-quit', '-projectPath', $Repo, '-buildTarget', 'WSAPlayer',
               '-executeMethod', 'ScrubIn.EditorTools.BuildScript.BuildBatch', '-buildPath', $OutDir, '-logFile', $log)
    # WaitForExit, NOT Start-Process -Wait: -Wait also waits for Unity's lingering child processes (licensing
    # client, shader compiler), which added ~9 minutes per build.
    $p = Start-Process -FilePath $unity -ArgumentList $args1 -PassThru -NoNewWindow
    $null = $p.Handle   # PS 5.1 quirk: without touching Handle first, ExitCode comes back empty
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) {
        Write-Host '--- last Unity log lines ---' -ForegroundColor Yellow
        Get-Content $log -Tail 40 | ForEach-Object { Write-Host $_ }
        throw "Unity build failed (exit $($p.ExitCode)). Full log: $log"
    }
    Write-Host ("      Unity done in {0:mm\:ss}" -f $sw.Elapsed) -ForegroundColor DarkGray
}

# ---- 3: MSBuild -> .appx
$sln = Get-ChildItem $OutDir -Filter *.sln -File | Select-Object -First 1
if (-not $sln) { throw "No .sln in $OutDir -- run without -SkipUnity first." }
# Bump the package version every build so deploy.ps1 can update in place (no uninstall). Unity does not
# rewrite Package.appxmanifest when building into an existing folder, so edit it here.
# Version = 1.0.<days since 2026-01-01>.<seconds today / 2>: always increasing, each part < 65535.
$manifest = Get-ChildItem $OutDir -Directory | ForEach-Object { Join-Path $_.FullName 'Package.appxmanifest' } |
            Where-Object { Test-Path $_ } | Select-Object -First 1
if ($manifest) {
    $now = Get-Date
    $ver = '1.0.{0}.{1}' -f [int]($now.Date - [datetime]'2026-01-01').TotalDays, [int]($now.TimeOfDay.TotalSeconds / 2)
    $xmlText = [IO.File]::ReadAllText($manifest)
    $xmlText = [regex]::Replace($xmlText, '(<Identity\b[^>]*?\bVersion=")[^"]+(")', ('${1}' + $ver + '${2}'))
    [IO.File]::WriteAllText($manifest, $xmlText, (New-Object Text.UTF8Encoding($true)))
    Write-Host "      package version $ver" -ForegroundColor DarkGray
}

# Unity references the WindowsMobile extension SDK at the target SDK version. Newer SDKs (10.0.26100) don't ship
# it (MSB3774). Retarget the generated app project to the newest SDK whose WindowsMobile extension exists.
# (Unity does not rewrite this file on rebuilds into an existing folder, so patching here keeps builds incremental.)
$extRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\Extension SDKs\WindowsMobile"
$mobileVer = Get-ChildItem $extRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^10\.0\.\d+\.\d+$' } |
             Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty Name
foreach ($proj in Get-ChildItem $OutDir -Directory | ForEach-Object { Get-ChildItem $_.FullName -Filter *.vcxproj -File }) {
    $t = [IO.File]::ReadAllText($proj.FullName)
    $m = [regex]::Match($t, 'SDKReference Include="WindowsMobile, Version=([^"]+)"')
    if ($m.Success -and $mobileVer -and -not (Test-Path (Join-Path $extRoot $m.Groups[1].Value))) {
        $t = $t.Replace($m.Value, 'SDKReference Include="WindowsMobile, Version=' + $mobileVer + '"')
        $t = [regex]::Replace($t, '<WindowsTargetPlatformVersion>[^<]+</WindowsTargetPlatformVersion>', "<WindowsTargetPlatformVersion>$mobileVer</WindowsTargetPlatformVersion>")
        [IO.File]::WriteAllText($proj.FullName, $t, (New-Object Text.UTF8Encoding($true)))
        Write-Host "      retargeted $($proj.Name) to SDK $mobileVer (WindowsMobile extension)" -ForegroundColor DarkGray
    }
}

$mb = Find-MSBuild
if ($Toolset) { $mb.Toolset = $Toolset }
Write-Host "[2/2] MSBuild $($sln.Name) $Configuration|x86 $(if ($mb.Toolset) { '(toolset ' + $mb.Toolset + ')' })" -ForegroundColor Cyan
$mbArgs = @($sln.FullName, '/m', '/nologo', '/v:minimal',
            "/p:Configuration=$Configuration", '/p:Platform=x86',
            '/p:AppxBundle=Never', '/p:UapAppxPackageBuildMode=SideloadOnly', '/p:AppxPackageSigningEnabled=true',
            # Unity's Il2CppOutputProject is a Makefile vcxproj; MSBuild's common targets still resolve .NET
            # reference assemblies for it (default v4.0, which Build Tools 2019 ships only as a stub -> MSB3644).
            # Native C++ either way; point the lookup at the installed 4.8 pack.
            '/p:TargetFrameworkVersion=v4.8')
if ($mb.Toolset) { $mbArgs += "/p:PlatformToolset=$($mb.Toolset)" }
& $mb.Path @mbArgs
if ($LASTEXITCODE -ne 0) { throw "MSBuild failed (exit $LASTEXITCODE)." }

$pkg = Get-ChildItem $OutDir -Recurse -Include *.appx, *.appxbundle -File |
       Where-Object { $_.FullName -match '\\AppPackages\\' -and $_.FullName -notmatch '\\Dependencies\\' } |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $pkg) { throw "MSBuild succeeded but no .appx found under $OutDir\*\AppPackages" }
$sw.Stop()
Write-Host ''
Write-Host "PACKAGE: $($pkg.FullName)" -ForegroundColor Green
Write-Host ("TIME:    {0:mm\:ss}" -f $sw.Elapsed) -ForegroundColor Green
$pkg.FullName | Set-Content (Join-Path $PSScriptRoot '.last-package') -Encoding UTF8
