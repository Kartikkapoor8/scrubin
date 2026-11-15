# deploy.ps1 -- install the built .appx on the HoloLens and launch it.
#
# Usage:   powershell -ExecutionPolicy Bypass -File tools\deploy.ps1 [-Package <path.appx>] [-NoLaunch] [-Uninstall]
#          Default package = the one tools\build.ps1 produced last (tools\.last-package).
#          Updates in place (no uninstall) unless -Uninstall is given or the device rejects the update.
# Needs:   HOLOLENS_IP, HOLOLENS_USER, HOLOLENS_PASS in the environment or tools\.env.local (gitignored).
#          Kartik sets the credentials himself; this script never prints them.
#
# Path 1 (default): Windows Device Portal REST API (docs: learn.microsoft.com .../device-portal-api-reference)
#   GET    /api/app/packagemanager/packages          find the old install
#   DELETE /api/taskmanager/app?package=<hex64>&forcestop=yes          stop it if running
#   DELETE /api/app/packagemanager/package?package=<PackageFullName>   uninstall (only if needed)
#   POST   /api/app/packagemanager/package?package=<file.appx>         multipart upload (+ dependencies, .cer)
#   GET    /api/app/packagemanager/state             poll until done
#   POST   /api/taskmanager/app?appid=<hex64>&package=<hex64>          launch
#   (state-changing calls send the CSRF-Token cookie back as X-CSRF-Token; cert trust is scoped to HOLOLENS_IP)
# Path 2 (fallback): WinAppDeployCmd install -file ... -ip ... [-pin $env:HOLOLENS_PIN]

param([string]$Package, [switch]$NoLaunch, [switch]$Uninstall, [switch]$ForceFallback)

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

function Uninstall-Rest($old) {
    Write-Host "Uninstalling: $($old.PackageFullName)" -ForegroundColor Yellow
    $null = Invoke-DP -Method DELETE -Path '/api/app/packagemanager/package' -Query @{ package = $old.PackageFullName } -TimeoutSec 120
}

# Default: update in place (faster; build.ps1 bumps the version every build). The running app is stopped
# first. If the device rejects the update (e.g. signing cert changed), uninstall and install once more.
# One web session for the whole deploy. Device Portal sets CSRF-Token with no Path attribute, so the cookie is
# scoped to the directory of whatever URL handed it out. Priming with /api/os/info scoped it to /api/os/, so it
# was never sent (or echoed as X-CSRF-Token) on /api/app/... and the upload got HTTP 403. Prime with GET / instead
# so the cookie covers every path, then every Invoke-DP call and the upload reuse this session.
function Initialize-DPSession {
    # "auto-" usernames are Device Portal's CSRF-exempt form; we send the CSRF header, so use the plain name
    # (process memory only; tools\.env.local is not touched).
    if ($env:HOLOLENS_USER -like 'auto-*') { $env:HOLOLENS_USER = $env:HOLOLENS_USER.Substring(5) }
    $base = Get-DPBase; $nc = (Get-DPCredential).GetNetworkCredential()
    $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($nc.UserName + ':' + $nc.Password))
    $null = Invoke-WebRequest -Uri "$base/" -Headers @{ Authorization = "Basic $basic" } -UseBasicParsing `
        -SessionVariable s -TimeoutSec 15
    if (-not ($s.Cookies.GetCookies([Uri]"$base/") | Where-Object Name -eq 'CSRF-Token')) {
        throw 'Device Portal did not hand out a CSRF-Token cookie.'
    }
    $script:DPSession = $s
}

function Deploy-Rest {
    Initialize-DPSession
    $old = Find-Installed
    if ($old) {
        try { $null = Invoke-DP -Method DELETE -Path '/api/taskmanager/app' -Query @{ package = (ConvertTo-Hex64 $old.PackageFullName); forcestop = 'yes' } } catch {}
        if ($Uninstall) { Uninstall-Rest $old; $old = $null }
    }
    try { Install-Rest }
    catch {
        if (-not $old) { throw }
        Write-Host "Update in place failed ($($_.Exception.Message)); uninstalling and retrying once." -ForegroundColor Yellow
        Uninstall-Rest $old
        Install-Rest
    }
}

function Install-Rest {
    $base = Get-DPBase; $cred = Get-DPCredential

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
    # Send Basic auth up front: a streamed multipart body cannot be replayed after a 401 challenge.
    $nc = $cred.GetNetworkCredential()
    $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($nc.UserName + ':' + $nc.Password))
    $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Basic', $basic)
    $csrf = $script:DPSession.Cookies.GetCookies($base) | Where-Object Name -eq 'CSRF-Token' | Select-Object -First 1
    if ($csrf) { $null = $client.DefaultRequestHeaders.TryAddWithoutValidation('X-CSRF-Token', $csrf.Value) }

    # Plain multipart format (as Microsoft's WindowsDevicePortalWrapper writes it): unquoted boundary in the
    # Content-Type header and quoted name/filename without .NET's extra filename*= parameter. Device Portal's
    # parser is stricter than most servers, so don't rely on .NET's defaults.
    $boundary = [guid]::NewGuid().ToString('N')
    $form = New-Object System.Net.Http.MultipartFormDataContent($boundary)
    $null = $form.Headers.Remove('Content-Type')
    $null = $form.Headers.TryAddWithoutValidation('Content-Type', "multipart/form-data; boundary=$boundary")
    $streams = @()
    foreach ($f in $files) {
        $fs = [IO.File]::OpenRead($f); $streams += $fs
        $sc = New-Object System.Net.Http.StreamContent($fs)
        $name = [IO.Path]::GetFileName($f)
        $null = $sc.Headers.TryAddWithoutValidation('Content-Disposition', "form-data; name=`"$name`"; filename=`"$name`"")
        $sc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/octet-stream')
        $form.Add($sc)
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
    $ipOnly = ($env:HOLOLENS_IP -split ':')[0]
    Write-Host 'Fallback: WinAppDeployCmd (no auto-launch; start the app from the HoloLens Start menu).' -ForegroundColor Yellow
    Write-Host '(Microsoft documents WinAppDeployCmd mainly for IoT/Mobile; on HoloLens it may need pairing or not work.)' -ForegroundColor DarkGray
    $depArgs = @()
    $deps = Join-Path $pkgDir 'Dependencies\x86'
    if (Test-Path $deps) { $depArgs = @('-dependency') + (Get-ChildItem $deps -Filter *.appx | ForEach-Object FullName) }
    # Try an update first (keeps the install), then a clean uninstall + install.
    & $exe.FullName update -file $Package -ip $ipOnly @pinArgs @depArgs
    if ($LASTEXITCODE -eq 0) { return }
    & $exe.FullName uninstall -package $identity -ip $ipOnly @pinArgs 2>$null | Out-Null
    & $exe.FullName install -file $Package -ip $ipOnly @pinArgs @depArgs
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
        $msg = $_.Exception.Message
        Write-Host "Device Portal deploy failed: $msg" -ForegroundColor Red
        # The fallback can't fix these, and its own errors would only hide the real problem.
        if ($msg -match '401|Unauthorized') { throw 'Wrong Device Portal user/password (HOLOLENS_USER / HOLOLENS_PASS in tools\.env.local).' }
        if ($env:HOLOLENS_SCHEME -eq 'http') { throw 'USB deploy failed; WinAppDeployCmd fallback does not apply over USB. Check the cable and that Device Portal is on.' }
        if ($msg -match 'HOLOLENS_|No -Package|Package not found') { throw }
    }
}
Deploy-WinAppDeployCmd
Write-Host ("Deployed (fallback) in {0:mm\:ss}" -f $sw.Elapsed) -ForegroundColor Green
