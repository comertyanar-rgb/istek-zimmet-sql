# Google Sheet Kullanıcılar -> Zimmet SQL API Sync
# Bu dosyayi SQL API'ye erisebilen ic agdaki Windows PC/sunucuda calistirin.
# SQL API disariya acilmaz; bu script Google Apps Script'ten veriyi CEKER ve lokale yazar.
#
# Gerekli ortam degiskenleri:
# - PERSONNEL_EXPORT_URL       Apps Script Web App /exec URL'i
# - PERSONNEL_SYNC_SECRET      Apps Script Properties ve backend .env ile ayni secret
# - ZIMMET_API_URL             Opsiyonel. Varsayilan: http://localhost:8787/api/action

param(
  [string]$PersonnelExportUrl = $(if ($env:PERSONNEL_EXPORT_URL) { $env:PERSONNEL_EXPORT_URL } else { $env:ZIMMET_PERSONNEL_EXPORT_URL }),
  [string]$ZimmetApiUrl = $(if ($env:ZIMMET_API_URL) { $env:ZIMMET_API_URL } else { "http://localhost:8787/api/action" }),
  [int]$BatchSize = 500,
  [string]$LogPath = $(if ($env:PERSONNEL_SYNC_LOG) { $env:PERSONNEL_SYNC_LOG } else { "" }),
  [switch]$DryRun,
  [switch]$LogSuccess
)

$ErrorActionPreference = "Stop"

function Write-SyncLog {
  param([string]$Message)
  if ([string]::IsNullOrWhiteSpace($LogPath)) { return }
  $dir = Split-Path -Parent $LogPath
  if (-not [string]::IsNullOrWhiteSpace($dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

trap {
  Write-SyncLog "ERROR $($_.Exception.Message)"
  throw
}

$SyncSecret = if ($env:PERSONNEL_SYNC_SECRET) {
  $env:PERSONNEL_SYNC_SECRET
} elseif ($env:ZIMMET_PERSONNEL_SYNC_SECRET) {
  $env:ZIMMET_PERSONNEL_SYNC_SECRET
} else {
  $env:ZIMMET_SYNC_SECRET
}

if ([string]::IsNullOrWhiteSpace($PersonnelExportUrl)) {
  throw "PERSONNEL_EXPORT_URL ortam degiskeni bos. Apps Script Web App /exec URL'ini girin."
}
if ([string]::IsNullOrWhiteSpace($ZimmetApiUrl)) {
  throw "ZIMMET_API_URL bos."
}
if ([string]::IsNullOrWhiteSpace($SyncSecret)) {
  throw "PERSONNEL_SYNC_SECRET/ZIMMET_PERSONNEL_SYNC_SECRET ortam degiskeni bos."
}
if ($BatchSize -lt 1 -or $BatchSize -gt 1000) {
  throw "BatchSize 1 ile 1000 arasinda olmali."
}

function Get-ArraySlice {
  param(
    [object[]]$Items,
    [int]$Start,
    [int]$Count
  )

  $endExclusive = [Math]::Min($Start + $Count, $Items.Count)
  $slice = New-Object System.Collections.Generic.List[object]
  for ($i = $Start; $i -lt $endExclusive; $i++) {
    $slice.Add($Items[$i])
  }
  return @($slice.ToArray())
}

function Get-IntValue {
  param($Value)
  if ($null -eq $Value) { return 0 }
  try {
    return [int]$Value
  } catch {
    return 0
  }
}

$exportPayload = @{
  action = "exportPersonnelForSync"
  secret = $SyncSecret.Trim()
  machine = $env:COMPUTERNAME
} | ConvertTo-Json -Depth 6

$exportResult = Invoke-RestMethod `
  -Uri $PersonnelExportUrl `
  -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body $exportPayload

if (-not $exportResult.success) {
  throw "Personel export basarisiz: $($exportResult.error)"
}

$items = @($exportResult.items)

if ($DryRun) {
  Write-SyncLog "DRYRUN exportCount=$($items.Count) exportedAt=$($exportResult.syncedAt)"
  [pscustomobject]@{
    success = $true
    mode = "dry-run"
    exportCount = $items.Count
    exportedAt = $exportResult.syncedAt
  }
  return
}

$inserted = 0
$updated = 0
$skipped = 0
$warnings = New-Object System.Collections.Generic.List[string]

for ($start = 0; $start -lt $items.Count; $start += $BatchSize) {
  $batch = Get-ArraySlice -Items $items -Start $start -Count $BatchSize

  $payload = @{
    action = "syncPersonnel"
    secret = $SyncSecret.Trim()
    machine = $env:COMPUTERNAME
    items = $batch
  } | ConvertTo-Json -Depth 12

  $result = Invoke-RestMethod `
    -Uri $ZimmetApiUrl `
    -Method Post `
    -ContentType "application/json; charset=utf-8" `
    -Body $payload

  if (-not $result.success) {
    throw "SQL personel sync basarisiz: $($result.error)"
  }

  $inserted += Get-IntValue $result.inserted
  $updated += Get-IntValue $result.updated
  $skipped += Get-IntValue $result.skipped
  foreach ($warning in @($result.warnings)) {
    if (-not [string]::IsNullOrWhiteSpace($warning)) {
      $warnings.Add([string]$warning) | Out-Null
    }
  }
}

$summary = [pscustomobject]@{
  success = $true
  exportCount = $items.Count
  inserted = $inserted
  updated = $updated
  skipped = $skipped
  warningCount = $warnings.Count
  warnings = @($warnings.ToArray())
}

if ($LogSuccess -or $inserted -gt 0 -or $skipped -gt 0 -or $warnings.Count -gt 0) {
  Write-SyncLog "OK exportCount=$($items.Count) inserted=$inserted updated=$updated skipped=$skipped warnings=$($warnings.Count)"
}

$summary
