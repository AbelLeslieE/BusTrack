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

Invoke-Check -Path "/health" -ExpectedStatuses @(200)
Invoke-Check -Path "/ready" -ExpectedStatuses @(200)
Invoke-Check -Path "/" -ExpectedStatuses @(200)
Invoke-Check -Path "/docs" -ExpectedStatuses @(404)
Invoke-Check -Path "/openapi.json" -ExpectedStatuses @(404)
Invoke-Check -Path "/api/routes" -ExpectedStatuses @(401, 403)

Write-Host "Read-only deployment verification passed."
