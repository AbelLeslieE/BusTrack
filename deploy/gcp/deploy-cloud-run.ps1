[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [string]$Image,

    [Parameter(Mandatory = $true)]
    [string]$CloudSqlInstance,

    [string]$Region = "asia-south1",
    [string]$WebServiceName = "bustrack-web",
    [string]$WorkerServiceName = "bustrack-worker",
    [string]$RuntimeServiceAccount = "bustrack-runtime",
    [string]$DatabaseSecret = "bustrack-database-url",
    [ValidateRange(1, 2147483647)]
    [int]$DatabaseSecretVersion = 1,
    [string]$JwtSecret = "bustrack-jwt-secret",
    [ValidateRange(1, 2147483647)]
    [int]$JwtSecretVersion = 1,
    [string]$BusPassSecret = "bustrack-bus-pass-signing-key",
    [ValidateRange(1, 2147483647)]
    [int]$BusPassSecretVersion = 1,
    [string]$BootstrapAdminSecret = "bustrack-bootstrap-admin-password",
    [ValidateRange(1, 2147483647)]
    [int]$BootstrapAdminSecretVersion = 1,
    [string[]]$OptionalSecretBindings = @(),
    [ValidateRange(0, 20)]
    [int]$WebMinInstances = 0,
    [ValidateRange(1, 100)]
    [int]$WebMaxInstances = 3
)

$ErrorActionPreference = "Stop"

function Invoke-Gcloud {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & gcloud @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud failed: gcloud $($Arguments -join ' ')"
    }
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "The Google Cloud CLI (gcloud) is required."
}
if ($WebMinInstances -gt $WebMaxInstances) {
    throw "WebMinInstances cannot be greater than WebMaxInstances."
}
if ($CloudSqlInstance -notmatch '^[^:]+:[^:]+:[^:]+$') {
    throw "CloudSqlInstance must be the full PROJECT:REGION:INSTANCE connection name."
}
if ($Image -notmatch '\.pkg\.dev/.+/.+:.+$') {
    throw "Image must be a tagged Artifact Registry image URL."
}

$serviceAccountEmail = "$RuntimeServiceAccount@$ProjectId.iam.gserviceaccount.com"
$requiredSecrets = @(
    $DatabaseSecret,
    $JwtSecret,
    $BusPassSecret,
    $BootstrapAdminSecret
)

foreach ($binding in $OptionalSecretBindings) {
    if ($binding -notmatch '^[A-Z][A-Z0-9_]*=[a-zA-Z0-9_-]+(?::[1-9][0-9]*)?$') {
        throw "Optional secret bindings must use ENVIRONMENT_VARIABLE=secret-name:version format."
    }
    $secretReference = ($binding -split '=', 2)[1]
    $requiredSecrets += ($secretReference -split ':', 2)[0]
}

if (-not $PSCmdlet.ShouldProcess($ProjectId, "configure APIs, IAM, and deploy BusTrack to Cloud Run")) {
    return
}

Invoke-Gcloud config set project $ProjectId
Invoke-Gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com logging.googleapis.com monitoring.googleapis.com

& gcloud iam service-accounts describe $serviceAccountEmail --project $ProjectId *> $null
if ($LASTEXITCODE -ne 0) {
    Invoke-Gcloud iam service-accounts create $RuntimeServiceAccount --project $ProjectId --display-name "BusTrack runtime"
}

foreach ($role in @("roles/cloudsql.client", "roles/logging.logWriter", "roles/monitoring.metricWriter")) {
    Invoke-Gcloud projects add-iam-policy-binding $ProjectId --member "serviceAccount:$serviceAccountEmail" --role $role --condition None --quiet
}

foreach ($secretName in ($requiredSecrets | Sort-Object -Unique)) {
    Invoke-Gcloud secrets describe $secretName --project $ProjectId
    Invoke-Gcloud secrets add-iam-policy-binding $secretName --project $ProjectId --member "serviceAccount:$serviceAccountEmail" --role roles/secretmanager.secretAccessor --condition None --quiet
}

$secretBindings = @(
    "DATABASE_URL=$DatabaseSecret`:$DatabaseSecretVersion",
    "JWT_SECRET_KEY=$JwtSecret`:$JwtSecretVersion",
    "BUS_PASS_SIGNING_KEY_PEM=$BusPassSecret`:$BusPassSecretVersion",
    "BOOTSTRAP_ADMIN_PASSWORD=$BootstrapAdminSecret`:$BootstrapAdminSecretVersion"
)
$secretBindings += $OptionalSecretBindings | ForEach-Object {
    $parts = $_ -split '=', 2
    $reference = $parts[1]
    if ($reference -notmatch ':') {
        $reference = "$reference`:1"
    }
    "$($parts[0])=$reference"
}
$secretArgument = $secretBindings -join ','

$commonEnvironment = @(
    "APP_ENV=production",
    "LOG_LEVEL=INFO",
    "FORWARDED_ALLOW_IPS=*",
    "STATIC_ASSET_CACHE_SECONDS=3600",
    "ACCESS_TOKEN_EXPIRE_MINUTES=480",
    "TELEMETRY_RETENTION_ENABLED=true",
    "REQUEST_AUDIT_SUCCESS_GET_SAMPLE_RATE=0.01",
    "REQUEST_AUDIT_RETENTION_DAYS=30",
    "STUDENT_LIVE_STREAM_ENABLED=true",
    "DRIVER_SOURCE_STREAM_ENABLED=true",
    "ADMIN_LIVE_STREAM_ENABLED=true"
) -join ','

Invoke-Gcloud run deploy $WebServiceName `
    --project $ProjectId `
    --region $Region `
    --platform managed `
    --image $Image `
    --port 8080 `
    --service-account $serviceAccountEmail `
    --set-cloudsql-instances $CloudSqlInstance `
    --set-secrets $secretArgument `
    --set-env-vars "$commonEnvironment,BACKGROUND_JOBS_ENABLED=false" `
    --cpu 1 `
    --memory 512Mi `
    --concurrency 80 `
    --timeout 3600 `
    --min-instances $WebMinInstances `
    --max-instances $WebMaxInstances `
    --cpu-throttling `
    --allow-unauthenticated `
    --startup-probe "httpGet.path=/ready,httpGet.port=8080,initialDelaySeconds=0,failureThreshold=20,timeoutSeconds=2,periodSeconds=3" `
    --liveness-probe "httpGet.path=/health,httpGet.port=8080,initialDelaySeconds=10,failureThreshold=3,timeoutSeconds=2,periodSeconds=30" `
    --deploy-health-check `
    --quiet

# One continuously allocated instance owns polling/reminders. The service is
# internal-only because browsers and GPS providers must use the web service.
Invoke-Gcloud run deploy $WorkerServiceName `
    --project $ProjectId `
    --region $Region `
    --platform managed `
    --image $Image `
    --port 8080 `
    --service-account $serviceAccountEmail `
    --set-cloudsql-instances $CloudSqlInstance `
    --set-secrets $secretArgument `
    --set-env-vars "$commonEnvironment,BACKGROUND_JOBS_ENABLED=true" `
    --cpu 1 `
    --memory 512Mi `
    --concurrency 1 `
    --timeout 3600 `
    --min-instances 1 `
    --max-instances 1 `
    --no-cpu-throttling `
    --ingress internal `
    --no-allow-unauthenticated `
    --startup-probe "httpGet.path=/ready,httpGet.port=8080,initialDelaySeconds=0,failureThreshold=20,timeoutSeconds=2,periodSeconds=3" `
    --liveness-probe "httpGet.path=/health,httpGet.port=8080,initialDelaySeconds=10,failureThreshold=3,timeoutSeconds=2,periodSeconds=30" `
    --deploy-health-check `
    --quiet

Invoke-Gcloud run services describe $WebServiceName --project $ProjectId --region $Region --format "value(status.url)"
