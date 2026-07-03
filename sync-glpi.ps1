# GLPI -> Zimmet SQL API Sync
# Bu dosyayi GLPI'ye erisebilen ic agdaki Windows PC/sunucuda calistirin.
# Token degerlerini bu dosyaya yazmayin; Windows ortam degiskenlerinden okunur.

$ErrorActionPreference = "Stop"

$GlpiApi = "https://btdestek.istek.k12.tr/api.php/v1"
$ZimmetApiUrl = if ($env:ZIMMET_API_URL) { $env:ZIMMET_API_URL } else { "http://localhost:8787/api/action" }

$AppToken = $env:GLPI_APP_TOKEN
$UserToken = $env:GLPI_USER_TOKEN
$SyncSecret = if ($env:GLPI_SYNC_SECRET) { $env:GLPI_SYNC_SECRET } else { $env:ZIMMET_SYNC_SECRET }
# Varsayilan calisma sadece GLPI_Cihazlar sekmesini yeniler.
# Laptoplar sekmesindeki GLPI eslesme kolonlarini hemen yenilemek icin:
# $env:ZIMMET_GLPI_RECONCILE = "true"
# Mesai saatlerinde eslestirmeyi Islem_Kuyrugu'na almak icin:
# $env:ZIMMET_GLPI_RECONCILE = "queue"
$RunReconcileRaw = $env:ZIMMET_GLPI_RECONCILE
if ($RunReconcileRaw -match '^(queue|kuyruk)$') {
  $RunReconcile = "queue"
} else {
  $RunReconcile = $RunReconcileRaw -match '^(1|true|yes|evet)$'
}

if ([string]::IsNullOrWhiteSpace($AppToken)) { throw "GLPI_APP_TOKEN ortam degiskeni bos." }
if ([string]::IsNullOrWhiteSpace($UserToken)) { throw "GLPI_USER_TOKEN ortam degiskeni bos." }
if ([string]::IsNullOrWhiteSpace($SyncSecret)) { throw "GLPI_SYNC_SECRET/ZIMMET_SYNC_SECRET ortam degiskeni bos." }
if ([string]::IsNullOrWhiteSpace($ZimmetApiUrl)) { throw "ZIMMET_API_URL bos." }

function Convert-GlpiText {
  param($Value)
  if ($null -eq $Value) { return "" }
  if ($Value -is [double] -or $Value -is [single] -or $Value -is [decimal]) {
    return $Value.ToString("0", [System.Globalization.CultureInfo]::InvariantCulture)
  }
  return [string]$Value
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
    secret = $SyncSecret
    items = $items
    reconcile = $RunReconcile
  } | ConvertTo-Json -Depth 8

  $result = Invoke-RestMethod $ZimmetApiUrl -Method Post -ContentType "application/json; charset=utf-8" -Body $payload
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
