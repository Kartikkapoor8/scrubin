# build.ps1 -- build the HoloLens 1 app package (.appx) from the Unity project, one command.
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\build.ps1 [-SkipUnity] [-Configuration Release]
#            -SkipUnity      reuse the UWP solution already in C:\b\scrubin (e.g. after "ScrubIn/Build HoloLens (x86)")
#            -Toolset v143   force an MSVC toolset (only needed if VS 2019 is missing and VS 2022 is used)
#
# Steps: 1) refuse if the project is open in the Unity Editor (batch mode would fail)
#        2) Unity batch mode -> ScrubIn.HoloLensBuild.BuildBatch -> UWP solution in C:\b\scrubin
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
    if ($m) { return @{ Path = $m; Toolset = '' } }
    $m = & $vswhere -products * -version '[17.0,18.0)' -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
    if ($m) { return @{ Path = $m; Toolset = 'v143' } }   # VS 2022: retarget Unity's v142 project
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
               '-executeMethod', 'ScrubIn.HoloLensBuild.BuildBatch', '-buildPath', $OutDir, '-logFile', $log)
    $p = Start-Process -FilePath $unity -ArgumentList $args1 -Wait -PassThru -NoNewWindow
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
$mb = Find-MSBuild
if ($Toolset) { $mb.Toolset = $Toolset }
Write-Host "[2/2] MSBuild $($sln.Name) $Configuration|x86 $(if ($mb.Toolset) { '(toolset ' + $mb.Toolset + ')' })" -ForegroundColor Cyan
$mbArgs = @($sln.FullName, '/m', '/nologo', '/v:minimal', '/restore',
            "/p:Configuration=$Configuration", '/p:Platform=x86',
            '/p:AppxBundle=Never', '/p:UapAppxPackageBuildMode=SideloadOnly', '/p:AppxPackageSigningEnabled=true')
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
