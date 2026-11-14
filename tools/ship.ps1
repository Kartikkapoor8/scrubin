# ship.ps1 -- pull latest code, build the HoloLens package, deploy + launch it. One command.
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\ship.ps1 [-NoPull] [-SkipUnity] [-NoLaunch]
# Same requirements as build.ps1 (Unity Editor closed) and deploy.ps1 (HOLOLENS_* set).

param([string]$Repo = 'C:\dev\scrubin', [switch]$NoPull, [switch]$SkipUnity, [switch]$NoLaunch)

$ErrorActionPreference = 'Stop'
$sw = [Diagnostics.Stopwatch]::StartNew()
if (-not $NoPull) {
    Write-Host '[pull] git pull --rebase' -ForegroundColor Cyan
    git -C $Repo pull --rebase
    if ($LASTEXITCODE -ne 0) { throw 'git pull --rebase failed (local changes or conflict). Fix, then re-run.' }
    git -C $Repo log --oneline -1
}
$b = @{}; if ($SkipUnity) { $b.SkipUnity = $true }
& "$PSScriptRoot\build.ps1" -Repo $Repo @b
$d = @{}; if ($NoLaunch) { $d.NoLaunch = $true }
& "$PSScriptRoot\deploy.ps1" @d
Write-Host ("SHIPPED in {0:mm\:ss}" -f $sw.Elapsed) -ForegroundColor Green
