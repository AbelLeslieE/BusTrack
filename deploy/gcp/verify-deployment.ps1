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
    if ([int]$response.StatusCode -ne 200 -or -not $response.Content.Contains($ExpectedText)) {
        throw "$Path did not serve the expected release asset."
    }
    Write-Host "PASS $Path -> current release asset"
}

Invoke-Check -Path "/health" -ExpectedStatuses @(200)
Invoke-Check -Path "/ready" -ExpectedStatuses @(200)
Invoke-Check -Path "/" -ExpectedStatuses @(200)
Invoke-Check -Path "/docs" -ExpectedStatuses @(404)
Invoke-Check -Path "/openapi.json" -ExpectedStatuses @(404)
Invoke-Check -Path "/api/routes" -ExpectedStatuses @(401, 403)
Assert-AssetContains -Path "/dashboard" -ExpectedText "fleetGlass.css?v=20261102fleetglass2"
Assert-AssetContains -Path "/dashboard" -ExpectedText "clamp(180px, 26vw, 240px)"
Assert-AssetContains -Path "/static/modules/css/fleetGlass.css?v=20261102fleetglass2" -ExpectedText "rgba(131, 185, 225, .28)"
Assert-AssetContains -Path "/static/common/layout.css?v=20261102loader2" -ExpectedText ".page-loader__logo"

Write-Host "Read-only deployment verification passed."
