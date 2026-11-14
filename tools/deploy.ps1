# deploy.ps1 -- install the built .appx on the HoloLens and launch it.
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\deploy.ps1 [-Package <path.appx>] [-NoLaunch]
#          Default package = the one tools\build.ps1 produced last (tools\.last-package).
# Needs:   HOLOLENS_IP, HOLOLENS_USER, HOLOLENS_PASS in the environment or tools\.env.local (gitignored).
#          Kartik sets the credentials himself; this script never prints them.
#
# Path 1 (default): Windows Device Portal REST API (docs: learn.microsoft.com .../device-portal-api-reference)
#   GET    /api/app/packagemanager/packages          find the old install
#   DELETE /api/app/packagemanager/package?package=<PackageFullName>   uninstall it
#   POST   /api/app/packagemanager/package?package=<file.appx>         multipart upload (+ dependencies, .cer)
#   GET    /api/app/packagemanager/state             poll until done
#   POST   /api/taskmanager/app?appid=<hex64>&package=<hex64>          launch
#   (state-changing calls send the CSRF-Token cookie back as X-CSRF-Token; cert trust is scoped to HOLOLENS_IP)
# Path 2 (fallback): WinAppDeployCmd install -file ... -ip ... [-pin $env:HOLOLENS_PIN]

param([string]$Package, [switch]$NoLaunch, [switch]$ForceFallback)

. "$PSScriptRoot\_common.ps1"
Import-ScrubInEnv
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not $Package) {
    $last = Join-Path $PSScriptRoot '.last-package'
    if (-not (Test-Path $last)) { throw 'No -Package given and no previous build. Run tools\build.ps1 first.' }
    $Package = (Get-Content $last -Raw).Trim()
}
if (-not (Test-Path $Package)) { throw "Package not found: $Package" }
$Package = (Resolve-Path $Package).Path
$pkgDir = Split-Path $Package -Parent

# Identity name from the package manifest (so we can find/uninstall the old version).
function Get-IdentityName([string]$appx) {
    $zip = [IO.Compression.ZipFile]::OpenRead($appx)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName -eq 'AppxManifest.xml' } | Select-Object -First 1
        if (-not $entry) { return $null }   # bundle: fall back to the file name
        $sr = New-Object IO.StreamReader($entry.Open()); [xml]$x = $sr.ReadToEnd(); $sr.Close()
        return $x.Package.Identity.Name
    } finally { $zip.Dispose() }
}
$identity = Get-IdentityName $Package
if (-not $identity) { $identity = ([IO.Path]::GetFileNameWithoutExtension($Package) -split '_')[0] }
Write-Host "Package: $(Split-Path $Package -Leaf)   identity: $identity" -ForegroundColor Cyan

function Find-Installed {
    $list = Invoke-DP -Path '/api/app/packagemanager/packages'
    $list.InstalledPackages | Where-Object { $_.PackageFamilyName -like "$identity`_*" -or $_.Name -eq $identity } | Select-Object -First 1
}

function Deploy-Rest {
    $base = Get-DPBase; $cred = Get-DPCredential
    $null = Invoke-DP -Path '/api/os/info'   # primes session + CSRF cookie

    $old = Find-Installed
    if ($old) {
        Write-Host "Uninstalling old: $($old.PackageFullName)" -ForegroundColor Yellow
        $null = Invoke-DP -Method DELETE -Path '/api/app/packagemanager/package' -Query @{ package = $old.PackageFullName } -TimeoutSec 120
    }

    # Multipart upload with HttpClient (PS 5.1's Invoke-WebRequest has no -Form).
    $files = @($Package)
    $deps = Join-Path $pkgDir 'Dependencies\x86'
    if (Test-Path $deps) { $files += (Get-ChildItem $deps -Filter *.appx | ForEach-Object FullName) }
    $cer = Get-ChildItem $pkgDir -Filter *.cer | Select-Object -First 1
    if ($cer) { $files += $cer.FullName }

    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.Credentials = $cred.GetNetworkCredential()
    $handler.CookieContainer = $script:DPSession.Cookies
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(10)
    $csrf = $script:DPSession.Cookies.GetCookies($base) | Where-Object Name -eq 'CSRF-Token' | Select-Object -First 1
    if ($csrf) { $null = $client.DefaultRequestHeaders.TryAddWithoutValidation('X-CSRF-Token', $csrf.Value) }

    $form = New-Object System.Net.Http.MultipartFormDataContent
    $streams = @()
    foreach ($f in $files) {
        $fs = [IO.File]::OpenRead($f); $streams += $fs
        $sc = New-Object System.Net.Http.StreamContent($fs)
        $sc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/octet-stream')
        $name = [IO.Path]::GetFileName($f)
        $form.Add($sc, $name, $name)
    }
    $leaf = [Uri]::EscapeDataString((Split-Path $Package -Leaf))
    $mb = [math]::Round(((($files | ForEach-Object { (Get-Item $_).Length }) | Measure-Object -Sum).Sum) / 1MB, 1)
    Write-Host "Uploading $($files.Count) file(s), $mb MB..." -ForegroundColor Cyan
    try {
        $resp = $client.PostAsync("$base/api/app/packagemanager/package?package=$leaf", $form).GetAwaiter().GetResult()
        if (-not $resp.IsSuccessStatusCode) { throw "Upload failed: HTTP $([int]$resp.StatusCode) $($resp.Content.ReadAsStringAsync().Result)" }
    } finally { $streams | ForEach-Object { $_.Dispose() }; $client.Dispose() }

    # Poll install state: 204 = still installing, 200 = finished (check Success).
    Write-Host -NoNewline 'Installing'
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 1500
        Write-Host -NoNewline '.'
        try { $r = Invoke-DP -Path '/api/app/packagemanager/state' -Raw } catch { continue }
        if ($r.StatusCode -eq 204) { continue }
        $st = $r.Content | ConvertFrom-Json
        Write-Host ''
        if ($st.Success -eq $false -or ($st.Code -and $st.Code -ne 0)) { throw "Install failed: $($st.CodeText) $($st.Reason)" }
        Write-Host 'Installed.' -ForegroundColor Green
        return
    }
    throw 'Install timed out after 5 minutes.'
}

function Launch-Rest {
    $app = Find-Installed
    if (-not $app) { throw "Installed, but $identity not found in the package list." }
    $null = Invoke-DP -Method POST -Path '/api/taskmanager/app' -Query @{
        appid = (ConvertTo-Hex64 $app.PackageRelativeId); package = (ConvertTo-Hex64 $app.PackageFullName) }
    Write-Host "Launched $($app.PackageRelativeId)" -ForegroundColor Green
}

function Deploy-WinAppDeployCmd {
    $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    $exe = Get-ChildItem $kits -Recurse -Filter WinAppDeployCmd.exe -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $exe) { throw 'WinAppDeployCmd not found (Windows SDK).' }
    $pinArgs = @(); if ($env:HOLOLENS_PIN) { $pinArgs = @('-pin', $env:HOLOLENS_PIN) }
    Write-Host 'Fallback: WinAppDeployCmd (no auto-launch; start the app from the HoloLens Start menu)' -ForegroundColor Yellow
    & $exe.FullName uninstall -package $identity -ip $env:HOLOLENS_IP @pinArgs 2>$null | Out-Null
    $depArgs = @()
    $deps = Join-Path $pkgDir 'Dependencies\x86'
    if (Test-Path $deps) { $depArgs = @('-dependency') + (Get-ChildItem $deps -Filter *.appx | ForEach-Object FullName) }
    & $exe.FullName install -file $Package -ip $env:HOLOLENS_IP @pinArgs @depArgs
    if ($LASTEXITCODE -ne 0) { throw "WinAppDeployCmd failed (exit $LASTEXITCODE)." }
}

$sw = [Diagnostics.Stopwatch]::StartNew()
if (-not $ForceFallback) {
    try {
        Deploy-Rest
        if (-not $NoLaunch) { Launch-Rest }
        Write-Host ("Deployed in {0:mm\:ss}" -f $sw.Elapsed) -ForegroundColor Green
        exit 0
    } catch {
        Write-Host "Device Portal deploy failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}
Deploy-WinAppDeployCmd
Write-Host ("Deployed (fallback) in {0:mm\:ss}" -f $sw.Elapsed) -ForegroundColor Green
