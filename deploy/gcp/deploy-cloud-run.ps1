[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [string]$Image,

    [string]$CloudSqlInstance,
    [switch]$ExternalDatabase,

    [string]$Region = "asia-south1",
    [string]$WebServiceName = "bustrack-web",
    [string]$WorkerServiceName = "bustrack-worker",
    [string]$PeakWorkerJobName = "bustrack-gps-peak",
    [string]$StandbyWorkerJobName = "bustrack-gps-standby",
    [string]$PeakMorningScheduleName = "bustrack-gps-peak-morning",
    [string]$PeakEveningScheduleName = "bustrack-gps-peak-evening",
    [string]$StandbyDayScheduleName = "bustrack-gps-standby-day",
    [string]$MidnightMaintenanceScheduleName = "bustrack-maintenance-midnight",
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
    [string]$GoogleOAuthClientIdSecret = "bustrack-google-oauth-client-id",
    [ValidateRange(1, 2147483647)]
    [int]$GoogleOAuthClientIdSecretVersion = 1,
    [string]$GoogleOAuthClientSecret = "bustrack-google-oauth-client-secret",
    [ValidateRange(1, 2147483647)]
    [int]$GoogleOAuthClientSecretVersion = 1,
    [string]$GoogleOAuthRedirectUriSecret = "bustrack-google-oauth-redirect-uri",
    [ValidateRange(1, 2147483647)]
    [int]$GoogleOAuthRedirectUriSecretVersion = 1,
    [string[]]$OptionalSecretBindings = @(),
    [switch]$SkipProjectSetup,
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

function Set-CloudSchedulerJob {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Schedule,
        [Parameter(Mandatory = $true)][string]$TargetJob
    )

    $targetUri = "https://run.googleapis.com/v2/projects/$ProjectId/locations/$Region/jobs/$TargetJob`:run"
    & gcloud scheduler jobs describe $Name --project $ProjectId --location $Region *> $null
    $action = if ($LASTEXITCODE -eq 0) { "update" } else { "create" }
    Invoke-Gcloud scheduler jobs $action http $Name `
        --project $ProjectId `
        --location $Region `
        --schedule $Schedule `
        --time-zone "Asia/Kolkata" `
        --uri $targetUri `
        --http-method POST `
        --oauth-service-account-email $serviceAccountEmail `
        --oauth-token-scope "https://www.googleapis.com/auth/cloud-platform" `
        --attempt-deadline 320s `
        --quiet
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "The Google Cloud CLI (gcloud) is required."
}
if ($WebMinInstances -gt $WebMaxInstances) {
    throw "WebMinInstances cannot be greater than WebMaxInstances."
}
if (-not $ExternalDatabase -and $CloudSqlInstance -notmatch '^[^:]+:[^:]+:[^:]+$') {
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
    $BootstrapAdminSecret,
    $GoogleOAuthClientIdSecret,
    $GoogleOAuthClientSecret,
    $GoogleOAuthRedirectUriSecret
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

if (-not $SkipProjectSetup) {
    Invoke-Gcloud config set project $ProjectId
    Invoke-Gcloud services enable run.googleapis.com cloudscheduler.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com logging.googleapis.com monitoring.googleapis.com

    & gcloud iam service-accounts describe $serviceAccountEmail --project $ProjectId *> $null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Gcloud iam service-accounts create $RuntimeServiceAccount --project $ProjectId --display-name "BusTrack runtime"
    }

    $runtimeRoles = @("roles/logging.logWriter", "roles/monitoring.metricWriter")
    if (-not $ExternalDatabase) {
        $runtimeRoles = @("roles/cloudsql.client") + $runtimeRoles
    }
    foreach ($role in $runtimeRoles) {
        Invoke-Gcloud projects add-iam-policy-binding $ProjectId --member "serviceAccount:$serviceAccountEmail" --role $role --condition None --quiet
    }

    foreach ($secretName in ($requiredSecrets | Sort-Object -Unique)) {
        Invoke-Gcloud secrets describe $secretName --project $ProjectId
        Invoke-Gcloud secrets add-iam-policy-binding $secretName --project $ProjectId --member "serviceAccount:$serviceAccountEmail" --role roles/secretmanager.secretAccessor --condition None --quiet
    }
}

$secretBindings = @(
    "DATABASE_URL=$DatabaseSecret`:$DatabaseSecretVersion",
    "JWT_SECRET_KEY=$JwtSecret`:$JwtSecretVersion",
    "BUS_PASS_SIGNING_KEY_PEM=$BusPassSecret`:$BusPassSecretVersion",
    "BOOTSTRAP_ADMIN_PASSWORD=$BootstrapAdminSecret`:$BootstrapAdminSecretVersion",
    "GOOGLE_OAUTH_CLIENT_ID=$GoogleOAuthClientIdSecret`:$GoogleOAuthClientIdSecretVersion",
    "GOOGLE_OAUTH_CLIENT_SECRET=$GoogleOAuthClientSecret`:$GoogleOAuthClientSecretVersion",
    "GOOGLE_OAUTH_REDIRECT_URI=$GoogleOAuthRedirectUriSecret`:$GoogleOAuthRedirectUriSecretVersion"
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

$databaseArguments = @()
if (-not $ExternalDatabase) {
    $databaseArguments = @('--set-cloudsql-instances', $CloudSqlInstance)
}

$commonEnvironment = @(
    "APP_ENV=production",
    "ENABLE_ROUTE_STUDIO=true",
    "ROUTE_STUDIO_ROAD_MATCHING_ENABLED=true",
    "ROUTE_STUDIO_ROUTER_TIMEOUT_SECONDS=12",
    "LOG_LEVEL=INFO",
    "FORWARDED_ALLOW_IPS=*",
    "STATIC_ASSET_CACHE_SECONDS=3600",
    "ACCESS_TOKEN_EXPIRE_MINUTES=480",
    "DATABASE_POOL_SIZE=8",
    "DATABASE_MAX_OVERFLOW=4",
    "GOOGLE_OAUTH_ALLOWED_DOMAIN=sahrdaya.ac.in",
    "TELEMETRY_RETENTION_ENABLED=true",
    "REQUEST_AUDIT_SUCCESS_GET_SAMPLE_RATE=0.01",
    "REQUEST_AUDIT_RETENTION_DAYS=30",
    "STUDENT_LIVE_STREAM_ENABLED=true",
    "DRIVER_SOURCE_STREAM_ENABLED=true",
    "ADMIN_LIVE_STREAM_ENABLED=true"
) -join ','

$workerEnvironment = "$commonEnvironment,BACKGROUND_JOBS_ENABLED=false,GPS_SCHEDULE_TIMEZONE=Asia/Kolkata,GPS_PEAK_POLL_INTERVAL_SECONDS=10,GPS_STANDBY_POLL_INTERVAL_MINUTES=30"

# Cloud Run can retain a ready revision when only a mutable image tag changes.
# A unique suffix makes every release pull and serve its newly built image.
$revisionSuffix = "r$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())-$((Get-Random -Maximum 10000).ToString('0000'))"

Invoke-Gcloud run deploy $WebServiceName `
    --project $ProjectId `
    --region $Region `
    --platform managed `
    --image $Image `
    --revision-suffix $revisionSuffix `
    --execution-environment gen2 `
    --port 8080 `
    --service-account $serviceAccountEmail `
    @databaseArguments `
    --set-secrets $secretArgument `
    --set-env-vars "$commonEnvironment,BACKGROUND_JOBS_ENABLED=false" `
    --cpu 1 `
    --memory 512Mi `
    --concurrency 12 `
    --timeout 3600 `
    --min-instances $WebMinInstances `
    --max-instances $WebMaxInstances `
    --cpu-throttling `
    --allow-unauthenticated `
    --startup-probe "httpGet.path=/ready,httpGet.port=8080,initialDelaySeconds=0,failureThreshold=60,timeoutSeconds=2,periodSeconds=5" `
    --liveness-probe "httpGet.path=/health,httpGet.port=8080,initialDelaySeconds=10,failureThreshold=3,timeoutSeconds=2,periodSeconds=30" `
    --deploy-health-check `
    --quiet

# An existing explicit traffic target can leave the freshly created web
# revision idle even when gcloud reports a successful deployment.
Invoke-Gcloud run services update-traffic $WebServiceName `
    --project $ProjectId `
    --region $Region `
    --to-revisions "${WebServiceName}-${revisionSuffix}=100" `
    --quiet

# The peak job exists only during the two daily bus windows. It polls every ten
# seconds and exits exactly when the current IST window closes.
Invoke-Gcloud run jobs deploy $PeakWorkerJobName `
    --project $ProjectId `
    --region $Region `
    --image $Image `
    --service-account $serviceAccountEmail `
    @databaseArguments `
    --set-secrets $secretArgument `
    --set-env-vars $workerEnvironment `
    --command python `
    --args "-m,backend.gps_worker,--mode,peak" `
    --cpu 1 `
    --memory 512Mi `
    --tasks 1 `
    --parallelism 1 `
    --max-retries 1 `
    --task-timeout 4h `
    --quiet

# The standby job is a one-shot process. Scheduler calls it every 30 minutes;
# the application rejects peak-window overlaps and the 20:30 boundary.
Invoke-Gcloud run jobs deploy $StandbyWorkerJobName `
    --project $ProjectId `
    --region $Region `
    --image $Image `
    --service-account $serviceAccountEmail `
    @databaseArguments `
    --set-secrets $secretArgument `
    --set-env-vars $workerEnvironment `
    --command python `
    --args "-m,backend.gps_worker,--mode,standby" `
    --cpu 1 `
    --memory 512Mi `
    --tasks 1 `
    --parallelism 1 `
    --max-retries 1 `
    --task-timeout 10m `
    --quiet

# Scheduler signs each invocation as the runtime identity. Bind only these two
# jobs instead of granting a project-wide invocation role.
Invoke-Gcloud run jobs add-iam-policy-binding $PeakWorkerJobName `
    --project $ProjectId `
    --region $Region `
    --member "serviceAccount:$serviceAccountEmail" `
    --role roles/run.invoker `
    --condition None `
    --quiet
Invoke-Gcloud run jobs add-iam-policy-binding $StandbyWorkerJobName `
    --project $ProjectId `
    --region $Region `
    --member "serviceAccount:$serviceAccountEmail" `
    --role roles/run.invoker `
    --condition None `
    --quiet

Set-CloudSchedulerJob -Name $PeakMorningScheduleName -Schedule "0 7 * * *" -TargetJob $PeakWorkerJobName
Set-CloudSchedulerJob -Name $PeakEveningScheduleName -Schedule "15 16 * * *" -TargetJob $PeakWorkerJobName
Set-CloudSchedulerJob -Name $StandbyDayScheduleName -Schedule "0,30 9-20 * * *" -TargetJob $StandbyWorkerJobName
Set-CloudSchedulerJob -Name $MidnightMaintenanceScheduleName -Schedule "1 0 * * *" -TargetJob $StandbyWorkerJobName

# Remove the superseded 24-hour, minimum-one-instance worker only after both
# jobs, their IAM bindings, and every trigger have been configured successfully.
& gcloud run services describe $WorkerServiceName --project $ProjectId --region $Region *> $null
if ($LASTEXITCODE -eq 0) {
    Invoke-Gcloud run services delete $WorkerServiceName `
        --project $ProjectId `
        --region $Region `
        --quiet
}

Invoke-Gcloud run services describe $WebServiceName --project $ProjectId --region $Region --format "value(status.url)"
