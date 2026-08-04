# Google Sheet Kullanıcılar -> Zimmet SQL API Sync
# Bu dosyayı SQL API'ye erişebilen iç ağdaki Windows PC/sunucuda çalıştırın.
# SQL API disariya acilmaz; bu script Google Apps Script'ten veriyi CEKER ve lokale yazar.
#
# Gerekli ortam değişkenleri:
# - PERSONNEL_EXPORT_URL       Apps Script Web App /exec URL'i
# - PERSONNEL_SYNC_SECRET      Apps Script Properties ve backend .env ile ayni secret
# - ZIMMET_API_URL             Opsiyonel. Varsayılan: http://localhost:8787/api/action

param(
  [string]$PersonnelExportUrl = $(if ($env:PERSONNEL_EXPORT_URL) { $env:PERSONNEL_EXPORT_URL } else { $env:ZIMMET_PERSONNEL_EXPORT_URL }),
  [string]$ZimmetApiUrl = $(if ($env:ZIMMET_API_URL) { $env:ZIMMET_API_URL } else { "http://localhost:8787/api/action" }),
  [int]$BatchSize = 5000,
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
  throw "PERSONNEL_EXPORT_URL ortam değişkeni boş. Apps Script Web App /exec URL'ini girin."
}
if ([string]::IsNullOrWhiteSpace($ZimmetApiUrl)) {
  throw "ZIMMET_API_URL bos."
}
if ([string]::IsNullOrWhiteSpace($SyncSecret)) {
  throw "PERSONNEL_SYNC_SECRET/ZIMMET_PERSONNEL_SYNC_SECRET ortam değişkeni boş."
}
if ($BatchSize -lt 1 -or $BatchSize -gt 5000) {
  throw "BatchSize 1 ile 5000 arasında olmalı."
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

function Invoke-SignedZimmetApi {
  param(
    [string]$Uri,
    [hashtable]$Payload,
    [string]$Secret,
    [int]$Depth = 12,
    [int]$TimeoutSec = 120
  )

  $json = $Payload | ConvertTo-Json -Depth $Depth -Compress
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
  $nonce = [Guid]::NewGuid().ToString("N")
  $prefixBytes = [System.Text.Encoding]::UTF8.GetBytes("$timestamp`n$nonce`n")
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $stream = New-Object System.IO.MemoryStream
  try {
    $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($Secret)
    $stream.Write($prefixBytes, 0, $prefixBytes.Length)
    $stream.Write($bodyBytes, 0, $bodyBytes.Length)
    $stream.Position = 0
    $signature = ([BitConverter]::ToString($hmac.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $hmac.Dispose()
  }

  $headers = @{
    "X-Zimmet-Timestamp" = $timestamp
    "X-Zimmet-Nonce" = $nonce
    "X-Zimmet-Signature" = $signature
    "X-Zimmet-Action" = [string]$Payload.action
  }
  return Invoke-RestMethod -Uri $Uri -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bodyBytes -TimeoutSec $TimeoutSec
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
  throw "Personel export başarısız: $($exportResult.error)"
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
$unchanged = 0
$skipped = 0
$warningCount = 0
$maxWarningDetails = 200
$warnings = New-Object System.Collections.Generic.List[string]

for ($start = 0; $start -lt $items.Count; $start += $BatchSize) {
  $batch = Get-ArraySlice -Items $items -Start $start -Count $BatchSize

  $payload = @{
    action = "syncPersonnel"
    machine = $env:COMPUTERNAME
    items = $batch
  }

  $result = Invoke-SignedZimmetApi `
    -Uri $ZimmetApiUrl `
    -Payload $payload `
    -Secret $SyncSecret.Trim() `
    -Depth 12

  if (-not $result.success) {
    throw "SQL personel sync başarısız: $($result.error)"
  }

  $inserted += Get-IntValue $result.inserted
  $updated += Get-IntValue $result.updated
  $unchanged += Get-IntValue $result.unchanged
  $skipped += Get-IntValue $result.skipped
  $batchWarnings = @($result.warnings)
  if ($null -ne $result.warningCount) {
    $warningCount += Get-IntValue $result.warningCount
  } else {
    $warningCount += $batchWarnings.Count
  }
  foreach ($warning in $batchWarnings) {
    if ($warnings.Count -lt $maxWarningDetails -and -not [string]::IsNullOrWhiteSpace($warning)) {
      $warnings.Add([string]$warning) | Out-Null
    }
  }
}

$summary = [pscustomobject]@{
  success = $true
  exportCount = $items.Count
  inserted = $inserted
  updated = $updated
  unchanged = $unchanged
  skipped = $skipped
  warningCount = $warningCount
  warningsTruncated = $warningCount -gt $warnings.Count
  warnings = @($warnings.ToArray())
}

if ($LogSuccess -or $inserted -gt 0 -or $skipped -gt 0 -or $warningCount -gt 0) {
  Write-SyncLog "OK exportCount=$($items.Count) inserted=$inserted updated=$updated unchanged=$unchanged skipped=$skipped warnings=$warningCount"
}

$summary
