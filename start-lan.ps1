[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

# The frontend is served by FastAPI and calls /api with relative URLs, so it
# works from any device that opens this server's LAN address.
$lanAddresses = Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.InterfaceAlias -notmatch "Loopback|WSL|vEthernet|Hyper-V|Bluetooth"
    }

$lanAddress = $lanAddresses | Select-Object -First 1 -ExpandProperty IPAddress
if ($lanAddress) {
    Write-Host "\nOpen this address on a phone connected to the same Wi-Fi:"
    Write-Host "  http://${lanAddress}:$Port/\n" -ForegroundColor Green
} else {
    Write-Warning "Could not determine a LAN IPv4 address. Run ipconfig and use your Wi-Fi IPv4 address."
}

Write-Host "If the phone cannot connect, allow inbound TCP port $Port in Windows Firewall (Private networks)."
Write-Host "Press Ctrl+C to stop the server.\n"

$projectPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $projectPython) {
    & $projectPython -m uvicorn backend.main:app --host 0.0.0.0 --port $Port --reload
} else {
    python -m uvicorn backend.main:app --host 0.0.0.0 --port $Port --reload
}
