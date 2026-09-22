[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,

    [string]$Region = "asia-south1",
    [string]$Repository = "bustrack"
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
if (-not $PSCmdlet.ShouldProcess($ProjectId, "enable APIs and prepare Artifact Registry/Cloud Build")) {
    return
}

Invoke-Gcloud config set project $ProjectId
Invoke-Gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com logging.googleapis.com monitoring.googleapis.com iam.googleapis.com

& gcloud artifacts repositories describe $Repository --project $ProjectId --location $Region *> $null
if ($LASTEXITCODE -ne 0) {
    Invoke-Gcloud artifacts repositories create $Repository --project $ProjectId --location $Region --repository-format docker --description "BusTrack application images"
}

$buildServiceAccount = (& gcloud builds get-default-service-account --project $ProjectId).Trim()
if ($LASTEXITCODE -ne 0 -or -not $buildServiceAccount) {
    throw "Unable to determine the Cloud Build service account."
}
Invoke-Gcloud projects add-iam-policy-binding $ProjectId --member "serviceAccount:$buildServiceAccount" --role roles/artifactregistry.writer --condition None --quiet
Invoke-Gcloud projects add-iam-policy-binding $ProjectId --member "serviceAccount:$buildServiceAccount" --role roles/logging.logWriter --condition None --quiet

Write-Host "Project preparation complete. Cloud Build service account: $buildServiceAccount"
