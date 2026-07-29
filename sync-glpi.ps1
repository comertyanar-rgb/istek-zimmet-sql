# GLPI -> Zimmet SQL API Sync
# Bu dosyayı GLPI'ye erişebilen iç ağdaki Windows PC/sunucuda çalıştırın.
# Token değerlerini bu dosyaya yazmayın; Windows ortam değişkenlerinden okunur.

$ErrorActionPreference = "Stop"

$GlpiApi = "https://btdestek.istek.k12.tr/api.php/v1"
$ZimmetApiUrl = if ($env:ZIMMET_API_URL) { $env:ZIMMET_API_URL } else { "http://localhost:8787/api/action" }

$AppToken = $env:GLPI_APP_TOKEN
$UserToken = $env:GLPI_USER_TOKEN
$SyncSecret = if ($env:GLPI_SYNC_SECRET) { $env:GLPI_SYNC_SECRET } else { $env:ZIMMET_SYNC_SECRET }
# Varsayılan çalışma sadece GLPI_Cihazlar sekmesini yeniler.
# Laptoplar sekmesindeki GLPI eşleşme kolonlarını hemen yenilemek için:
# $env:ZIMMET_GLPI_RECONCILE = "true"
# Mesai saatlerinde eşleştirmeyi İşlem Kuyruğu'na almak için:
# $env:ZIMMET_GLPI_RECONCILE = "queue"
$RunReconcileRaw = $env:ZIMMET_GLPI_RECONCILE
if ($RunReconcileRaw -match '^(queue|kuyruk)$') {
  $RunReconcile = "queue"
} else {
  $RunReconcile = $RunReconcileRaw -match '^(1|true|yes|evet)$'
}

if ([string]::IsNullOrWhiteSpace($AppToken)) { throw "GLPI_APP_TOKEN ortam değişkeni boş." }
if ([string]::IsNullOrWhiteSpace($UserToken)) { throw "GLPI_USER_TOKEN ortam değişkeni boş." }
if ([string]::IsNullOrWhiteSpace($SyncSecret)) { throw "GLPI_SYNC_SECRET/ZIMMET_SYNC_SECRET ortam değişkeni boş." }
if ([string]::IsNullOrWhiteSpace($ZimmetApiUrl)) { throw "ZIMMET_API_URL bos." }

function Convert-GlpiText {
  param($Value)
  if ($null -eq $Value) { return "" }
  if ($Value -is [double] -or $Value -is [single] -or $Value -is [decimal]) {
    return $Value.ToString("0", [System.Globalization.CultureInfo]::InvariantCulture)
  }
  return [string]$Value
}

function Invoke-SignedZimmetApi {
  param(
    [string]$Uri,
    [hashtable]$Payload,
    [string]$Secret,
    [int]$Depth = 10,
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
  return Invoke-RestMethod $Uri -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bodyBytes -TimeoutSec $TimeoutSec
}

$loginHeaders = @{
  "App-Token" = $AppToken.Trim()
  "Authorization" = "user_token $($UserToken.Trim())"
}

$session = Invoke-RestMethod "$GlpiApi/initSession" -Method Get -Headers $loginHeaders

try {
  $apiHeaders = @{
    "App-Token" = $AppToken.Trim()
    "Session-Token" = $session.session_token
  }

  $allComputers = @()
  $start = 0
  $pageSize = 999

  while ($true) {
    $end = $start + $pageSize
    $url = "$GlpiApi/Computer?range=$start-$end&expand_dropdowns=true&get_hateoas=false"
    $page = Invoke-RestMethod $url -Method Get -Headers $apiHeaders

    if ($null -eq $page -or $page.Count -eq 0) { break }

    $allComputers += $page

    if ($page.Count -lt ($pageSize + 1)) { break }
    $start = $end + 1
  }

  $items = $allComputers | ForEach-Object {
    @{
      glpiId = $_.id
      serial = Convert-GlpiText $_.serial
      computerName = Convert-GlpiText $_.name
      manufacturer = Convert-GlpiText $_.manufacturers_id
      model = Convert-GlpiText $_.computermodels_id
      adUser = Convert-GlpiText $_.users_id
      location = Convert-GlpiText $_.locations_id
      lastInventory = Convert-GlpiText $_.date_mod
    }
  }

  $payload = @{
    action = "syncGLPI"
    items = $items
    reconcile = $RunReconcile
  }

  $result = Invoke-SignedZimmetApi -Uri $ZimmetApiUrl -Payload $payload -Secret $SyncSecret -Depth 8
  $result
}
finally {
  if ($session.session_token) {
    $apiHeaders = @{
      "App-Token" = $AppToken.Trim()
      "Session-Token" = $session.session_token
    }
    Invoke-RestMethod "$GlpiApi/killSession" -Method Get -Headers $apiHeaders | Out-Null
  }
}
