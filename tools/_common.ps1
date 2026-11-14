# _common.ps1 -- shared helpers for ScrubIn tools (dot-source it: . "$PSScriptRoot\_common.ps1")
#
# Provides:
#   Import-ScrubInEnv          loads HOLOLENS_IP / HOLOLENS_USER / HOLOLENS_PASS from tools\.env.local
#                              (KEY=VALUE lines) unless already set in the environment. Never prints values.
#   Enable-HoloLensCert -Ip    trusts the Device Portal's self-signed cert for THAT host only.
#   Get-DPCredential           PSCredential built from HOLOLENS_USER / HOLOLENS_PASS.
#   Invoke-DP                  calls the HoloLens Device Portal REST API (handles CSRF token + cookies).
#   Write-Check                prints one row of a check/cross status table.
#
# PowerShell 5.1 compatible. No secrets are ever written to the console.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$script:OK   = [string][char]0x2713   # check mark
$script:BAD  = [string][char]0x2717   # cross
$script:WARN = '!'

function Write-Check {
    param([string]$Status, [string]$Name, [string]$Detail = '')
    switch ($Status) {
        'ok'   { $sym = $script:OK;   $col = 'Green' }
        'bad'  { $sym = $script:BAD;  $col = 'Red' }
        'warn' { $sym = $script:WARN; $col = 'Yellow' }
        default{ $sym = '-';          $col = 'Gray' }
    }
    Write-Host (' {0} ' -f $sym) -ForegroundColor $col -NoNewline
    Write-Host ('{0,-34}' -f $Name) -NoNewline
    Write-Host $Detail -ForegroundColor Gray
}

function Import-ScrubInEnv {
    $envFile = Join-Path $PSScriptRoot '.env.local'
    if (Test-Path $envFile) {
        foreach ($line in Get-Content $envFile) {
            if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
            $k, $v = $line -split '=', 2
            $k = $k.Trim(); $v = $v.Trim().Trim('"')
            if ($k -and -not [Environment]::GetEnvironmentVariable($k, 'Process')) {
                [Environment]::SetEnvironmentVariable($k, $v, 'Process')
            }
        }
    }
}

# Certificate trust scoped to one host. PowerShell scriptblock callbacks break on background
# threads in 5.1, so this is a small compiled C# callback instead.
if (-not ('ScrubIn.HostCertTrust' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
namespace ScrubIn {
    public static class HostCertTrust {
        public static string AllowedHost = null;
        public static bool Validate(object sender, X509Certificate cert, X509Chain chain, SslPolicyErrors errors) {
            if (errors == SslPolicyErrors.None) return true;
            var req = sender as HttpWebRequest;
            if (req != null && AllowedHost != null &&
                string.Equals(req.RequestUri.Host, AllowedHost, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }
        public static void Install(string host) {
            AllowedHost = host;
            ServicePointManager.ServerCertificateValidationCallback = Validate;
        }
    }
}
'@
}

function Enable-HoloLensCert {
    param([Parameter(Mandatory)][string]$Ip)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
    [ScrubIn.HostCertTrust]::Install($Ip)
}

function Get-DPCredential {
    if (-not $env:HOLOLENS_USER -or -not $env:HOLOLENS_PASS) {
        throw 'HOLOLENS_USER / HOLOLENS_PASS not set. Put them in tools\.env.local (gitignored) or set them in your shell yourself.'
    }
    $sec = ConvertTo-SecureString $env:HOLOLENS_PASS -AsPlainText -Force
    New-Object System.Management.Automation.PSCredential($env:HOLOLENS_USER, $sec)
}

# HOLOLENS_IP may include a port. HOLOLENS_SCHEME defaults to https (Wi-Fi). Over USB, HoloLens 1 serves Device
# Portal at http://127.0.0.1:10080, so set HOLOLENS_IP=127.0.0.1:10080 and HOLOLENS_SCHEME=http for a cable deploy.
function Get-DPBase {
    if (-not $env:HOLOLENS_IP) { throw 'HOLOLENS_IP not set (tools\.env.local or your shell).' }
    $scheme = if ($env:HOLOLENS_SCHEME) { $env:HOLOLENS_SCHEME } else { 'https' }
    Enable-HoloLensCert -Ip (($env:HOLOLENS_IP -split ':')[0])
    "${scheme}://$($env:HOLOLENS_IP)"
}

$script:DPSession = $null

# Invoke-DP -Method GET -Path '/api/os/info'
# Device Portal requires the CSRF-Token cookie echoed back as X-CSRF-Token on state-changing calls.
function Invoke-DP {
    param(
        [string]$Method = 'GET',
        [Parameter(Mandatory)][string]$Path,
        [hashtable]$Query,
        $Body,
        [string]$ContentType,
        [string]$InFile,
        [string]$OutFile,
        [int]$TimeoutSec = 60,
        [switch]$Raw
    )
    $base = Get-DPBase
    $cred = Get-DPCredential
    if (-not $script:DPSession) {
        # Prime a session: any authenticated GET hands back the CSRF-Token cookie.
        $null = Invoke-WebRequest -Uri "$base/api/os/info" -Credential $cred -UseBasicParsing `
            -SessionVariable s -TimeoutSec 15
        $script:DPSession = $s
    }
    $uri = "$base$Path"
    if ($Query) {
        $pairs = foreach ($k in $Query.Keys) { '{0}={1}' -f $k, [Uri]::EscapeDataString([string]$Query[$k]) }
        $uri += '?' + ($pairs -join '&')
    }
    $headers = @{}
    $csrf = $script:DPSession.Cookies.GetCookies($base) | Where-Object { $_.Name -eq 'CSRF-Token' } | Select-Object -First 1
    if ($csrf) { $headers['X-CSRF-Token'] = $csrf.Value }

    $p = @{ Uri = $uri; Method = $Method; Credential = $cred; WebSession = $script:DPSession
            Headers = $headers; UseBasicParsing = $true; TimeoutSec = $TimeoutSec }
    if ($PSBoundParameters.ContainsKey('Body')) { $p.Body = $Body }
    if ($ContentType) { $p.ContentType = $ContentType }
    if ($InFile)  { $p.InFile = $InFile }
    if ($OutFile) { $p.OutFile = $OutFile }
    $r = Invoke-WebRequest @p
    if ($OutFile) { return }
    if ($Raw) { return $r }
    if ($r.Content -and ($r.Headers['Content-Type'] -like '*json*' -or $r.Content.TrimStart().StartsWith('{'))) {
        return ($r.Content | ConvertFrom-Json)
    }
    $r.Content
}

function ConvertTo-Hex64 { param([string]$s) [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) }
