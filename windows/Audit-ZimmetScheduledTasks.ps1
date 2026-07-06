param(
  [switch]$DisableLegacy,
  [string]$ExportCsv = ""
)

$ErrorActionPreference = "Stop"

$newSilentTasks = @(
  "ISTEK Zimmet SQL API",
  "ISTEK Zimmet Personnel Sync",
  "ISTEK Zimmet GLPI Sync",
  "ISTEK Zimmet AD Password Agent",
  "ISTEK Zimmet Imza Agent"
)

$knownWorkPatterns = @(
  "sync-glpi.ps1",
  "sync-personnel.ps1",
  "Run-ADPasswordAgent.ps1",
  "Run-ImzaPipeline.ps1",
  "server.js",
  "npm run dev",
  "backend\\src\\server.js"
)

function Get-ActionText {
  param($Task)

  $parts = @()
  foreach ($action in $Task.Actions) {
    $execute = if ($action.Execute) { $action.Execute } else { "" }
    $arguments = if ($action.Arguments) { $action.Arguments } else { "" }
    $parts += ($execute + " " + $arguments).Trim()
  }
  return ($parts -join " | ")
}

function Get-TaskKind {
  param(
    [string]$TaskName,
    [string]$ActionText
  )

  $isNewName = $newSilentTasks -contains $TaskName
  $usesWscript = $ActionText -match "(^|\\)wscript\.exe(\s|$)|wscript\.exe"
  $taskNameLower = $TaskName.ToLowerInvariant()
  $actionTextLower = $ActionText.ToLowerInvariant()

  if ($isNewName -and $usesWscript) {
    return "YENI_SESSIZ"
  }

  if ($isNewName -and -not $usesWscript) {
    return "YENI_AMA_GORUNUR"
  }

  $nameLooksRelevant =
    $taskNameLower.Contains("zimmet") -or
    $taskNameLower.Contains("glpi") -or
    $taskNameLower.Contains("imza")

  $actionLooksRelevant = $false
  foreach ($pattern in $knownWorkPatterns) {
    if ($actionTextLower.Contains($pattern.ToLowerInvariant())) {
      $actionLooksRelevant = $true
      break
    }
  }

  if ($nameLooksRelevant -and $actionLooksRelevant -and -not $usesWscript) {
    return "ESKI_ADAY"
  }

  if ($nameLooksRelevant -or $actionLooksRelevant) {
    return "KONTROL_ET"
  }

  return "ILGISIZ"
}

$tasks = Get-ScheduledTask | ForEach-Object {
  $actionText = Get-ActionText $_
  $kind = Get-TaskKind -TaskName $_.TaskName -ActionText $actionText

  [PSCustomObject]@{
    Kind      = $kind
    State     = $_.State
    TaskName  = $_.TaskName
    TaskPath  = $_.TaskPath
    Action    = $actionText
  }
} | Where-Object { $_.Kind -ne "ILGISIZ" } | Sort-Object Kind, TaskName

if ($tasks.Count -eq 0) {
  Write-Host "Zimmet/GLPI/Imza ile ilgili gorev bulunamadi." -ForegroundColor Yellow
  exit 0
}

$tasks | Format-Table Kind, State, TaskName, TaskPath, Action -AutoSize -Wrap

if ($ExportCsv) {
  $tasks | Export-Csv -Path $ExportCsv -NoTypeInformation -Encoding UTF8
  Write-Host "Rapor yazildi: $ExportCsv" -ForegroundColor Cyan
}

if ($DisableLegacy) {
  $legacyTasks = $tasks | Where-Object { $_.Kind -eq "ESKI_ADAY" }
  if ($legacyTasks.Count -eq 0) {
    Write-Host "Devre disi birakilacak eski aday gorev yok." -ForegroundColor Green
    exit 0
  }

  foreach ($task in $legacyTasks) {
    Disable-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Out-Null
    Write-Host "Devre disi birakildi: $($task.TaskPath)$($task.TaskName)" -ForegroundColor Yellow
  }
}
else {
  Write-Host ""
  Write-Host "Bu rapor sadece okuma modunda calisti." -ForegroundColor Cyan
  Write-Host "ESKI_ADAY gorevleri kapatmak icin:" -ForegroundColor Cyan
  Write-Host "powershell.exe -ExecutionPolicy Bypass -File `".\windows\Audit-ZimmetScheduledTasks.ps1`" -DisableLegacy" -ForegroundColor White
}
