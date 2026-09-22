[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,

    [Parameter(Mandatory = $true)]
    [string]$Instance,

    # UTC time in HH:mm format. 18:30 UTC is midnight in India.
    [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')]
    [string]$BackupStartTime = "18:30",

    [ValidateRange(7, 365)]
    [int]$RetainedBackups = 14,

    [ValidateRange(1, 35)]
    [int]$TransactionLogDays = 7
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "The Google Cloud CLI (gcloud) is required."
}
if (-not $PSCmdlet.ShouldProcess($Instance, "enable Cloud SQL backups, PITR, storage growth, and deletion protection")) {
    return
}

& gcloud sql instances patch $Instance `
    --project $ProjectId `
    --backup-start-time $BackupStartTime `
    --retained-backups-count $RetainedBackups `
    --retained-transaction-log-days $TransactionLogDays `
    --enable-point-in-time-recovery `
    --storage-auto-increase `
    --deletion-protection `
    --retain-backups-on-delete `
    --final-backup `
    --final-backup-retention-days 30 `
    --quiet

if ($LASTEXITCODE -ne 0) {
    throw "Cloud SQL backup configuration failed."
}

& gcloud sql instances describe $Instance --project $ProjectId --format yaml
if ($LASTEXITCODE -ne 0) {
    throw "Cloud SQL verification failed."
}
