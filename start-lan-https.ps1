[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8443
)

$ErrorActionPreference = "Stop"

$network = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
    Select-Object -First 1
if (-not $network) {
    throw "No active Wi-Fi/LAN IPv4 address was found."
}

$lanAddress = $network.IPv4Address.IPAddress
$projectPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $projectPython)) {
    $projectPython = "python"
}

$certificateDir = Join-Path $PSScriptRoot ".certs"
& $projectPython (Join-Path $PSScriptRoot "scripts\create_lan_certificate.py") `
    --ip $lanAddress --output-dir $certificateDir

Write-Host "`nOpen this secure address on the iPhone:" -ForegroundColor Green
Write-Host "  https://${lanAddress}:$Port/`n" -ForegroundColor Green
Write-Host "Install and trust this one local CA certificate on the iPhone first:"
Write-Host "  $certificateDir\bus-track-local-ca.cer"
Write-Host "Then open Settings > General > About > Certificate Trust Settings and enable full trust for BusTrack Local Development CA.`n"

& $projectPython -m uvicorn backend.main:app --host 0.0.0.0 --port $Port `
    --ssl-keyfile (Join-Path $certificateDir "bus-track-lan-key.pem") `
    --ssl-certfile (Join-Path $certificateDir "bus-track-lan-cert.pem")
