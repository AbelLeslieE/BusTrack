[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://')]
    [string]$BaseUrl
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Invoke-Check {
    param(
        [string]$Path,
        [int[]]$ExpectedStatuses
    )

    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl$Path" -Method Get -MaximumRedirection 0 -SkipHttpErrorCheck
        $statusCode = [int]$response.StatusCode
    }
    catch {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        else {
            throw
        }
    }
    if ($statusCode -notin $ExpectedStatuses) {
        throw "$Path returned HTTP $statusCode; expected $($ExpectedStatuses -join ' or ')."
    }
    Write-Host "PASS $Path -> HTTP $statusCode"
}

function Assert-AssetContains {
    param(
        [string]$Path,
        [string]$ExpectedText
    )

    $response = Invoke-WebRequest -Uri "$BaseUrl$Path" -Method Get -SkipHttpErrorCheck
    $content = if ($response.Content -is [byte[]]) {
        [System.Text.Encoding]::UTF8.GetString($response.Content)
    } else {
        [string]$response.Content
    }
    if ([int]$response.StatusCode -ne 200 -or -not $content.Contains($ExpectedText)) {
        $references = [regex]::Matches($content, 'fleetGlass\.css[^"''\s<]*|layout\.css[^"''\s<]*|clamp\([^)]*\)') |
            Select-Object -First 8 | ForEach-Object { $_.Value }
        throw "$Path did not serve the expected release asset (HTTP $($response.StatusCode), $($content.Length) characters; found: $($references -join ', '))."
    }
    Write-Host "PASS $Path -> current release asset"
}

function Assert-GoogleSignupConfigured {
    $path = "/api/auth/google/signup"
    $nullDevice = if ($IsWindows) { "NUL" } else { "/dev/null" }
    $result = @(& curl `
        --silent `
        --show-error `
        --output $nullDevice `
        --write-out "%{http_code}`n%{redirect_url}" `
        "$BaseUrl$path")
    if ($LASTEXITCODE -ne 0 -or $result.Count -lt 2) {
        throw "$path could not be checked for its Google OAuth redirect."
    }
    $statusCode = [int]$result[0]
    $location = [string]$result[1]
    if (
        $statusCode -ne 302 `
        -or $location -notmatch '^https://accounts\.google\.com/o/oauth2/v2/auth\?' `
        -or $location -notmatch '(?:[?&])hd=sahrdaya\.ac\.in(?:&|$)'
    ) {
        throw "$path is not configured for Google OAuth (HTTP $statusCode; redirect: $location)."
    }
    Write-Host "PASS $path -> Google OAuth authorization"
}

function Assert-AuthorsAnimationPolicy {
    $path = "/authors"
    $response = Invoke-WebRequest -Uri "$BaseUrl$path" -Method Get -SkipHttpErrorCheck
    $content = [string]$response.Content
    $script = [regex]::Match($content, '<script>([\s\S]*?)</script>')
    if ([int]$response.StatusCode -ne 200 -or -not $script.Success) {
        throw "$path did not serve its embedded animation script."
    }
    $scriptBytes = [System.Text.Encoding]::UTF8.GetBytes($script.Groups[1].Value)
    $scriptHash = [Convert]::ToBase64String([System.Security.Cryptography.SHA256]::HashData($scriptBytes))
    $policy = [string]($response.Headers["Content-Security-Policy"] -join ", ")
    if (-not $policy.Contains("'sha256-$scriptHash'")) {
        throw "$path CSP did not authorize its embedded animation script."
    }
    Write-Host "PASS $path -> embedded animations authorized by CSP"
}

Invoke-Check -Path "/health" -ExpectedStatuses @(200)
Invoke-Check -Path "/ready" -ExpectedStatuses @(200)
Invoke-Check -Path "/" -ExpectedStatuses @(200)
Invoke-Check -Path "/docs" -ExpectedStatuses @(404)
Invoke-Check -Path "/openapi.json" -ExpectedStatuses @(404)
Invoke-Check -Path "/api/routes" -ExpectedStatuses @(401, 403)
Assert-GoogleSignupConfigured
Assert-AssetContains -Path "/" -ExpectedText "loginSplash.js?v=20261103fullready1"
Assert-AssetContains -Path "/" -ExpectedText "auth.js?v=20261103google2"
Assert-AssetContains -Path "/static/common/auth.js?v=20261103google2" -ExpectedText "account_exists"
Assert-AssetContains -Path "/static/common/loginSplash.js?v=20261103fullready1" -ExpectedText 'window.addEventListener("load"'
Assert-AssetContains -Path "/static/common/loginSplash.js?v=20261103fullready1" -ExpectedText "login.css?v=20261103route1"
Assert-AssetContains -Path "/static/common/login.css?v=20261103route1" -ExpectedText ".form-group select"
Assert-AssetContains -Path "/google-signup" -ExpectedText "googleSignup.js?v=20261103errors1"
Assert-AssetContains -Path "/static/common/googleSignup.js?v=20261103errors1" -ExpectedText "Spaces are not allowed"
Assert-AssetContains -Path "/dashboard" -ExpectedText "fleetGlass.css?v=20261103fleetglass7"
Assert-AssetContains -Path "/dashboard" -ExpectedText "bootstrap.js?v=20261105tracer1"
Assert-AssetContains -Path "/dashboard" -ExpectedText "clamp(180px, 26vw, 240px)"
Assert-AssetContains -Path "/static/modules/css/fleetGlass.css?v=20261103fleetglass7" -ExpectedText ".modal:has(#official-pass-name)"
Assert-AssetContains -Path "/static/common/bootstrap.js?v=20261105tracer1" -ExpectedText "router.js?v=20261105tracer1"
Assert-AssetContains -Path "/static/common/router.js?v=20261105tracer1" -ExpectedText "studentSidebar.js?v=20261103authors2"
Assert-AssetContains -Path "/static/modules/js/studentSidebar.js?v=20261103authors2" -ExpectedText "Meet the creators"
Assert-AssetContains -Path "/static/common/router.js?v=20261103providerdelay1" -ExpectedText "studentTracking.js?v=20261103providerdelay1"
Assert-AssetContains -Path "/static/modules/js/studentTracking.js?v=20261103providerdelay1" -ExpectedText "LAST GPS RECEIVED"
Assert-AssetContains -Path "/static/modules/css/studentTracking.css?v=20261103providerdelay1" -ExpectedText ".student-tracking-delay-card.is-delayed"
Assert-AssetContains -Path "/static/common/layout.css?v=20261102loader2" -ExpectedText ".page-loader__logo"
Assert-AssetContains -Path "/authors" -ExpectedText "Meet the Creators | BusTrack"
Assert-AssetContains -Path "/authors" -ExpectedText "KL 03 AA 2007"
Assert-AuthorsAnimationPolicy

Write-Host "Read-only deployment verification passed."
