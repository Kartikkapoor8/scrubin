# Copies the proven XR / remoting / UWP settings from the working rig project into this repo.
# Copies ONLY ProjectSettings/ and Packages/manifest.json. Nothing else from the rig belongs here.
#
#   powershell -ExecutionPolicy Bypass -File tools\setup-from-rig.ps1
#   powershell -ExecutionPolicy Bypass -File tools\setup-from-rig.ps1 -Rig D:\somewhere\anon-glass -Force

param(
    [string]$Rig = "C:\dev\anon-glass",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $Rig "ProjectSettings\ProjectSettings.asset"))) {
    Write-Host "Rig project not found at $Rig (no ProjectSettings\ProjectSettings.asset)." -ForegroundColor Red
    Write-Host "Pass -Rig <path>, or set the settings by hand: see docs\SETUP_WINDOWS.md, section B."
    exit 1
}
if (-not (Test-Path (Join-Path $Rig "Packages\manifest.json"))) {
    Write-Host "Rig has no Packages\manifest.json at $Rig." -ForegroundColor Red
    exit 1
}

$destSettings = Join-Path $Repo "ProjectSettings"
$destPackages = Join-Path $Repo "Packages"

if ((Test-Path (Join-Path $destSettings "ProjectSettings.asset")) -and -not $Force) {
    Write-Host "This repo already has ProjectSettings. Nothing copied." -ForegroundColor Yellow
    Write-Host "Re-run with -Force to overwrite them with the rig's."
    exit 0
}

New-Item -ItemType Directory -Force $destSettings | Out-Null
New-Item -ItemType Directory -Force $destPackages | Out-Null
Copy-Item (Join-Path $Rig "ProjectSettings\*") $destSettings -Recurse -Force
Copy-Item (Join-Path $Rig "Packages\manifest.json") (Join-Path $destPackages "manifest.json") -Force

Write-Host "Copied ProjectSettings\ and Packages\manifest.json from $Rig" -ForegroundColor Green

$versionFile = Join-Path $destSettings "ProjectVersion.txt"
if (Test-Path $versionFile) {
    Write-Host ""
    Write-Host "Unity version of the rig:"
    Get-Content $versionFile | ForEach-Object { Write-Host "  $_" }
}

$manifest = Get-Content (Join-Path $destPackages "manifest.json") -Raw
Write-Host ""
if ($manifest -match '"file:') {
    Write-Host "WARNING: manifest.json has local 'file:' package paths. They pointed inside the rig and will not" -ForegroundColor Yellow
    Write-Host "resolve here. Open Packages\manifest.json and remove or fix those lines before opening Unity." -ForegroundColor Yellow
}
if ($manifest -match 'com\.microsoft\.mixedreality') {
    Write-Host "NOTE: the rig's manifest references MRTK packages. ScrubIn does not use MRTK; tell Kartik's agent." -ForegroundColor Yellow
}
if ($manifest -notmatch 'com\.unity\.textmeshpro') {
    Write-Host "WARNING: TextMeshPro is not in the rig's manifest. Add it in Window > Package Manager (needed for labels)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next:"
Write-Host "  1. Open this folder in Unity (same 2019.4 version as above) through Unity Hub > Add."
Write-Host "  2. In Unity, run the menu  ScrubIn > Setup Project  once."
Write-Host "  3. Commit ProjectSettings\ and Packages\manifest.json so the team shares them."
