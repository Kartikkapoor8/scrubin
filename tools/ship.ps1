# ship.ps1 -- pull latest code, build the HoloLens package, deploy + launch it. One command.
#
# Usage:   tools\run ship [-NoPull] [-SkipUnity] [-NoLaunch] [-Uninstall]
#          (or: powershell -ExecutionPolicy Bypass -File tools\ship.ps1 ...)
# Same requirements as build.ps1 (Unity Editor closed) and deploy.ps1 (HOLOLENS_* set).

param([string]$Repo = 'C:\dev\scrubin', [switch]$NoPull, [switch]$SkipUnity, [switch]$NoLaunch, [switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$sw = [Diagnostics.Stopwatch]::StartNew()
if (-not $NoPull) {
    # --autostash: a Unity build can re-save settings files; set those aside, pull, then put them back.
    Write-Host '[pull] git pull --rebase --autostash' -ForegroundColor Cyan
    git -C $Repo pull --rebase --autostash
    if ($LASTEXITCODE -ne 0) { throw 'git pull --rebase failed (merge conflict?). Run "git -C C:\dev\scrubin status", fix, then re-run.' }
    git -C $Repo log --oneline -1
}
$b = @{}; if ($SkipUnity) { $b.SkipUnity = $true }
& "$PSScriptRoot\build.ps1" -Repo $Repo @b
$d = @{}; if ($NoLaunch) { $d.NoLaunch = $true }; if ($Uninstall) { $d.Uninstall = $true }
& "$PSScriptRoot\deploy.ps1" @d
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "deploy failed (exit $LASTEXITCODE)." }
Write-Host ("SHIPPED in {0:mm\:ss}" -f $sw.Elapsed) -ForegroundColor Green
