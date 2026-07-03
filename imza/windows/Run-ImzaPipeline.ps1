param(
  [string]$GamWork = "C:\GAMWork",
  [string]$PhotoshopExe = "C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe",
  [string]$PsdTemplate = "C:\GAMWork\template\imza-template-1.psd",
  [string]$TemplateDir = "C:\GAMWork\template",
  [string]$WinScpCom = "C:\Program Files (x86)\WinSCP\WinSCP.com",
  [string]$RemoteBasePath = "/public_html/imza",
  [string]$SignatureApiUrl = "http://localhost:8787/api/action",
  [string]$SignatureCallbackUrl = "",
  [string]$SignatureAgentSecret = "",
  [int]$SignatureFetchLimit = 5,
  [switch]$SkipSignatureFetch,
  [switch]$SkipSignatureCallback,
  [switch]$SkipPhotoshop,
  [switch]$SkipUpload,
  [switch]$SkipGam
)

$ErrorActionPreference = "Stop"

function Write-AgentInfo {
  param([string]$Message)
  Write-Host ("[ImzaAgent] " + $Message)
}

function Resolve-ToolPath {
  param(
    [string]$ConfiguredPath,
    [string[]]$CandidatePaths,
    [string]$ToolName
  )

  if (Test-Path -LiteralPath $ConfiguredPath) {
    return $ConfiguredPath
  }

  foreach ($candidate in $CandidatePaths) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  throw "$ToolName was not found. Configured path: $ConfiguredPath"
}

$WinScpCom = Resolve-ToolPath `
  -ConfiguredPath $WinScpCom `
  -CandidatePaths @(
    "C:\Program Files (x86)\WinSCP\WinSCP.com",
    "C:\Program Files\WinSCP\WinSCP.com"
  ) `
  -ToolName "WinSCP.com"

$DatasetDir = Join-Path $GamWork "datasets"
$HtmlDir = Join-Path $GamWork "signature"
$CommandDir = Join-Path $GamWork "commands"
$JpgDir = Join-Path $GamWork "jpg"
$ProcessedDir = Join-Path $GamWork "processed"
$LogDir = Join-Path $GamWork "logs"
$ScriptsDir = Join-Path $GamWork "scripts"
$JobDir = Join-Path $GamWork "job"

if ([string]::IsNullOrWhiteSpace($SignatureAgentSecret)) {
  if (![string]::IsNullOrWhiteSpace($env:SIGNATURE_AGENT_SECRET)) {
    $SignatureAgentSecret = $env:SIGNATURE_AGENT_SECRET
  } elseif (![string]::IsNullOrWhiteSpace($env:ZIMMET_SIGNATURE_AGENT_SECRET)) {
    $SignatureAgentSecret = $env:ZIMMET_SIGNATURE_AGENT_SECRET
  } elseif (![string]::IsNullOrWhiteSpace($env:AD_AGENT_SECRET)) {
    $SignatureAgentSecret = $env:AD_AGENT_SECRET
  } elseif (![string]::IsNullOrWhiteSpace($env:ZIMMET_SYNC_SECRET)) {
    $SignatureAgentSecret = $env:ZIMMET_SYNC_SECRET
  }
}

if (![string]::IsNullOrWhiteSpace($env:SIGNATURE_API_URL)) {
  $SignatureApiUrl = $env:SIGNATURE_API_URL
} elseif (![string]::IsNullOrWhiteSpace($env:ZIMMET_API_URL)) {
  $SignatureApiUrl = $env:ZIMMET_API_URL
}

if ([string]::IsNullOrWhiteSpace($SignatureCallbackUrl)) {
  if (![string]::IsNullOrWhiteSpace($env:SIGNATURE_CALLBACK_URL)) {
    $SignatureCallbackUrl = $env:SIGNATURE_CALLBACK_URL
  } else {
    $SignatureCallbackUrl = $SignatureApiUrl
  }
}

Write-AgentInfo "API: $SignatureApiUrl"
Write-AgentInfo ("Secret: " + $(if ([string]::IsNullOrWhiteSpace($SignatureAgentSecret)) { "YOK" } else { "VAR" }))
Write-AgentInfo "GAMWork: $GamWork"

foreach ($dir in @($DatasetDir, $HtmlDir, $CommandDir, $JpgDir, $ProcessedDir, $LogDir, $ScriptsDir, $JobDir)) {
  if (!(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
}

function ConvertTo-SafeFilePart {
  param([string]$Value)
  $part = if ([string]::IsNullOrWhiteSpace($Value)) { "signature" } else { $Value.Trim() }
  return ($part -replace '[\\/:*?"<>|]', '-')
}

function Format-SignatureCell {
  param($Value)
  $cell = if ($null -eq $Value) { "" } else { [string]$Value }
  if ($cell.Contains("`t") -or $cell.Contains('"') -or $cell.Contains("`n") -or $cell.Contains("`r")) {
    $cell = $cell.Replace('"', '""')
    return '"' + $cell + '"'
  }
  return $cell
}

function Get-SignatureTemplateSuffix {
  param([string]$Variant)
  $fileKey = Get-SignatureTemplateFileKey $Variant
  if ([string]::IsNullOrWhiteSpace($fileKey)) { return "_tpl1" }
  return "_tpl$fileKey"
}

function Get-SignatureTemplateFileKey {
  param([string]$Variant)
  $key = if ([string]::IsNullOrWhiteSpace($Variant)) { "normal" } else { $Variant.Trim().ToLowerInvariant() }
  if ($key -eq "normal") { return "1" }
  if ($key -eq "compact") { return "2" }
  if ($key -eq "small") { return "3" }
  if ($key -eq "tiny") { return "4" }

  $key = $key -replace '^imza-template-', ''
  $key = $key -replace '^template-', ''
  $key = $key -replace '^tpl', ''
  $key = $key -replace '[^a-zA-Z0-9_-]', ''
  if ([string]::IsNullOrWhiteSpace($key)) { return "1" }
  return $key
}

function New-SignatureHtml {
  param([string]$ImageUrl)
  $safeUrl = [System.Net.WebUtility]::HtmlEncode($ImageUrl)
  return @"
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>signature</title>
</head>
<body>
<img src="$safeUrl" width="568" style="width: 568px; max-width: 100%; height: auto; border: 0; display: block;">
</body>
</html>
"@
}

function Invoke-SignatureApi {
  param(
    [hashtable]$Payload,
    [string]$Url = $SignatureApiUrl,
    [int]$TimeoutSec = 60
  )

  if ([string]::IsNullOrWhiteSpace($Url)) {
    throw "Signature API URL is empty."
  }

  $json = $Payload | ConvertTo-Json -Depth 10 -Compress
  return Invoke-RestMethod -Uri $Url -Method Post -Body $json -ContentType "application/json; charset=utf-8" -TimeoutSec $TimeoutSec
}

function New-SignatureInputFilesFromJobs {
  param(
    [object[]]$Jobs,
    [string]$RunLog
  )

  if (!$Jobs -or $Jobs.Count -eq 0) { return 0 }

  $created = 0
  $groups = $Jobs | Group-Object {
    if ([string]::IsNullOrWhiteSpace([string]$_.templateVariant)) { "normal" } else { [string]$_.templateVariant }
  }

  foreach ($group in $groups) {
    $variant = [string]$group.Name
    $jobsInGroup = @($group.Group)
    $firstId = ConvertTo-SafeFilePart ([string]$jobsInGroup[0].signatureId)
    $stamp = (Get-Date -Format "yyyy-MM-dd_HHmmss") + "_" + $firstId + (Get-SignatureTemplateSuffix $variant)
    $datasetPath = Join-Path $DatasetDir ("Photoshop_Dataset_{0}.txt" -f $stamp)
    $gamPath = Join-Path $CommandDir ("gam_imza_{0}.cmd" -f $stamp)

    $datasetRows = New-Object System.Collections.Generic.List[string]
    $datasetRows.Add((@("filename", "ad", "unvan", "ing", "email", "adres", "CampusImage") | ForEach-Object { Format-SignatureCell $_ }) -join "`t")

    $commands = New-Object System.Collections.Generic.List[string]
    $commands.Add("@echo off")
    $commands.Add("setlocal")
    $commands.Add("cd /d C:\GAMWork")
    $commands.Add("")

    foreach ($job in $jobsInGroup) {
      $dataset = $job.dataset
      $signatureId = [string]$job.signatureId
      if ([string]::IsNullOrWhiteSpace($signatureId)) { continue }

      $personName = if (![string]::IsNullOrWhiteSpace([string]$job.personName)) { [string]$job.personName } else { [string]$dataset.name }
      $titleTr = if (![string]::IsNullOrWhiteSpace([string]$job.titleTr)) { [string]$job.titleTr } else { [string]$dataset.titleTr }
      $titleEn = if (![string]::IsNullOrWhiteSpace([string]$job.titleEn)) { [string]$job.titleEn } else { [string]$dataset.titleEn }
      $email = if (![string]::IsNullOrWhiteSpace([string]$job.personEmail)) { [string]$job.personEmail } else { [string]$dataset.email }
      $address = if (![string]::IsNullOrWhiteSpace([string]$job.address)) { [string]$job.address } else { [string]$dataset.address }
      $campusImage = if (![string]::IsNullOrWhiteSpace([string]$job.campusImage)) { [string]$job.campusImage } else { [string]$dataset.campusImage }
      $imageUrl = if (![string]::IsNullOrWhiteSpace([string]$job.imageUrl)) { [string]$job.imageUrl } else { [string]$dataset.imageUrl }

      $datasetRows.Add((@($signatureId, $personName, $titleTr, $titleEn, $email, $address, $campusImage) | ForEach-Object { Format-SignatureCell $_ }) -join "`t")

      $htmlPath = Join-Path $HtmlDir ($signatureId + ".html")
      Set-Content -LiteralPath $htmlPath -Value (New-SignatureHtml $imageUrl) -Encoding UTF8

      $gamCommand = if (![string]::IsNullOrWhiteSpace([string]$job.gamCommand)) {
        [string]$job.gamCommand
      } else {
        'gam user "{0}" signature file "signature/{1}.html" html' -f $email, $signatureId
      }
      $commands.Add($gamCommand)
    }

    $commands.Add("")
    $commands.Add("echo.")
    $commands.Add("echo Imza islemi tamamlandi.")
    $commands.Add("exit /b %ERRORLEVEL%")

    Set-Content -LiteralPath $datasetPath -Value ($datasetRows -join "`n") -Encoding UTF8
    Set-Content -LiteralPath $gamPath -Value ($commands -join "`r`n") -Encoding ASCII
    $created++

    if (![string]::IsNullOrWhiteSpace($RunLog)) {
      "SQL signature job files created: $datasetPath / $gamPath" | Tee-Object -FilePath $RunLog -Append
    }
  }

  return $created
}

function Receive-SignatureJobsFromSql {
  param([string]$RunLog)

  if ($SkipSignatureFetch) {
    Write-AgentInfo "SQL imza kuyruğu okunmadı: -SkipSignatureFetch verilmiş."
    return 0
  }
  if ([string]::IsNullOrWhiteSpace($SignatureAgentSecret)) {
    if (![string]::IsNullOrWhiteSpace($RunLog)) {
      "Signature SQL fetch skipped. SIGNATURE_AGENT_SECRET is empty." | Tee-Object -FilePath $RunLog -Append
    }
    Write-AgentInfo "SQL imza kuyruğu okunmadı: SIGNATURE_AGENT_SECRET / ZIMMET_SIGNATURE_AGENT_SECRET / AD_AGENT_SECRET boş."
    return 0
  }

  Write-AgentInfo "SQL imza kuyruğu okunuyor..."
  $payload = @{
    action = "fetchSignatureJobs"
    secret = $SignatureAgentSecret
    limit = $SignatureFetchLimit
    machine = $env:COMPUTERNAME
  }

  $response = Invoke-SignatureApi -Payload $payload -Url $SignatureApiUrl -TimeoutSec 60
  if (!$response.success) {
    throw "Signature SQL fetch failed: $($response.error)"
  }

  $jobs = @($response.jobs)
  Write-AgentInfo "SQL imza kuyruğundan alınan iş: $($jobs.Count)"

  if ($jobs.Count -eq 0) {
    if (![string]::IsNullOrWhiteSpace($RunLog)) {
      "No SQL signature jobs found." | Tee-Object -FilePath $RunLog -Append
    }
    return 0
  }

  return New-SignatureInputFilesFromJobs -Jobs $jobs -RunLog $RunLog
}

$LockFile = Join-Path $JobDir "pipeline.lock"
if (Test-Path -LiteralPath $LockFile) {
  $lockAge = (Get-Date) - (Get-Item -LiteralPath $LockFile).LastWriteTime
  if ($lockAge.TotalHours -lt 2) {
    Write-Host "Another pipeline run seems active. Exiting."
    exit 0
  }
}

Set-Content -LiteralPath $LockFile -Value (Get-Date).ToString("s")

try {
  $logStamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
  $runLog = Join-Path $LogDir ("pipeline_{0}.log" -f $logStamp)

  $dataset = Get-ChildItem -LiteralPath $DatasetDir -Filter "Photoshop_Dataset_*.txt" |
    Sort-Object LastWriteTime |
    Select-Object -First 1

  if (!$dataset) {
    $createdFromSql = Receive-SignatureJobsFromSql -RunLog $runLog
    if ($createdFromSql -gt 0) {
      $dataset = Get-ChildItem -LiteralPath $DatasetDir -Filter "Photoshop_Dataset_*.txt" |
        Sort-Object LastWriteTime |
        Select-Object -First 1
    }
  }

  if (!$dataset) {
    Write-AgentInfo "İş yok: SQL kuyruğunda bekleyen imza bulunamadı ve C:\GAMWork\datasets içinde hazır dataset yok."
    exit 0
  }

  if ($dataset.BaseName -notmatch "^Photoshop_Dataset_(.+)$") {
    throw "Dataset filename is not recognized: $($dataset.Name)"
  }

  $stamp = $Matches[1]
  $templateVariant = "normal"
  $gamFile = Join-Path $CommandDir ("gam_imza_{0}.cmd" -f $stamp)

  if (!(Test-Path -LiteralPath $gamFile)) {
    throw "Matching GAM command file was not found: $gamFile"
  }

  Write-AgentInfo "Dataset bulundu: $($dataset.FullName)"
  "Dataset: $($dataset.FullName)" | Tee-Object -FilePath $runLog -Append
  "GAM file: $gamFile" | Tee-Object -FilePath $runLog -Append

  $rows = Import-Csv -LiteralPath $dataset.FullName -Delimiter "`t"
  if (!$rows -or $rows.Count -eq 0) {
    throw "Dataset has no rows: $($dataset.FullName)"
  }

  if (!$SkipPhotoshop) {
    if (!(Test-Path -LiteralPath $PhotoshopExe)) {
      throw "Photoshop.exe was not found: $PhotoshopExe"
    }

    $activePsdTemplate = $PsdTemplate
    $templateVariant = "normal"
    $templateFileKey = Get-SignatureTemplateFileKey $templateVariant
    if ($stamp -match "_(compact|small|tiny|tpl[a-zA-Z0-9_-]+)$") {
      $templateVariant = $Matches[1]
      $templateFileKey = Get-SignatureTemplateFileKey $templateVariant
    }

    $variantTemplate = Join-Path $TemplateDir ("imza-template-{0}.psd" -f $templateFileKey)
    if (Test-Path -LiteralPath $variantTemplate) {
      $activePsdTemplate = $variantTemplate
    } else {
      "Template variant '$templateVariant' was requested but not found: $variantTemplate. Falling back to default template." | Tee-Object -FilePath $runLog -Append
    }

    if (!(Test-Path -LiteralPath $activePsdTemplate)) {
      throw "PSD template was not found: $activePsdTemplate"
    }

    $doneFile = Join-Path $JobDir ("photoshop_{0}.done" -f $stamp)
    $errorFile = Join-Path $JobDir ("photoshop_{0}.error.txt" -f $stamp)
    $jobFile = Join-Path $JobDir "photoshop-job.js"
    $bundledPhotoshopScript = Join-Path $PSScriptRoot "photoshop-generate-signatures.jsx"
    $photoshopScript = if (Test-Path -LiteralPath $bundledPhotoshopScript) {
      $bundledPhotoshopScript
    } else {
      Join-Path $ScriptsDir "photoshop-generate-signatures.jsx"
    }

    Remove-Item -LiteralPath $doneFile, $errorFile -ErrorAction SilentlyContinue

    $toJsPath = {
      param([string]$path)
      return $path.Replace("\", "/").Replace("'", "\\'")
    }

    $jobConfig = @"
var SIGNATURE_JOB = {
  psdPath: '$(& $toJsPath $activePsdTemplate)',
  datasetPath: '$(& $toJsPath $dataset.FullName)',
  outputDir: '$(& $toJsPath $JpgDir)',
  doneFile: '$(& $toJsPath $doneFile)',
  errorFile: '$(& $toJsPath $errorFile)'
};
"@

    Set-Content -LiteralPath $jobFile -Value $jobConfig -Encoding UTF8

    Write-AgentInfo "Photoshop başlatılıyor: $activePsdTemplate"
    "Starting Photoshop with template variant '$templateVariant': $activePsdTemplate" | Tee-Object -FilePath $runLog -Append
    Start-Process -FilePath $PhotoshopExe -ArgumentList @("-r", "`"$photoshopScript`"")

    $deadline = (Get-Date).AddMinutes(30)
    while ((Get-Date) -lt $deadline) {
      if (Test-Path -LiteralPath $doneFile) {
        "Photoshop completed." | Tee-Object -FilePath $runLog -Append
        break
      }
      if (Test-Path -LiteralPath $errorFile) {
        $psError = Get-Content -LiteralPath $errorFile -Raw
        throw "Photoshop script failed: $psError"
      }
      Start-Sleep -Seconds 5
    }

    if (!(Test-Path -LiteralPath $doneFile)) {
      throw "Photoshop did not finish within 30 minutes."
    }
  }

  if (!$SkipUpload) {
    if (!(Test-Path -LiteralPath $WinScpCom)) {
      throw "WinSCP.com was not found: $WinScpCom"
    }

    $sessionFile = Join-Path $ScriptsDir "winscp-open.txt"
    if (!(Test-Path -LiteralPath $sessionFile)) {
      throw "Missing WinSCP session file: $sessionFile"
    }

    $openLine = (Get-Content -LiteralPath $sessionFile -Raw).Trim()
    if (!$openLine.StartsWith("open ")) {
      throw "winscp-open.txt must contain one WinSCP open command."
    }

    $uploadScript = Join-Path $JobDir ("winscp-upload_{0}.txt" -f $stamp)
    $uploadLog = Join-Path $LogDir ("winscp_{0}.log" -f $stamp)
    $commands = New-Object System.Collections.Generic.List[string]

    $commands.Add("option batch abort")
    $commands.Add("option confirm off")
    $commands.Add($openLine)
    $commands.Add("binary")

    foreach ($row in $rows) {
      $id = [string]$row.filename
      if ([string]::IsNullOrWhiteSpace($id)) {
        throw "A dataset row has empty filename."
      }

      $jpgPath = Join-Path $JpgDir ($id + ".jpg")
      if (!(Test-Path -LiteralPath $jpgPath)) {
        throw "JPG was not found for upload: $jpgPath"
      }

      $remoteDir = ($RemoteBasePath.TrimEnd("/") + "/" + $id)
      $remoteFile = ($remoteDir + "/" + $id + ".jpg")

      $commands.Add("option batch continue")
      $commands.Add(('mkdir "{0}"' -f $remoteDir))
      $commands.Add("option batch abort")
      $commands.Add(('put "{0}" "{1}"' -f $jpgPath, $remoteFile))
    }

    $commands.Add("exit")
    Set-Content -LiteralPath $uploadScript -Value ($commands -join "`r`n") -Encoding ASCII

    Write-AgentInfo "JPG dosyaları WinSCP ile yükleniyor..."
    "Uploading JPG files with WinSCP..." | Tee-Object -FilePath $runLog -Append
    & $WinScpCom "/script=$uploadScript" "/log=$uploadLog"
    if ($LASTEXITCODE -ne 0) {
      throw "WinSCP upload failed. Check log: $uploadLog"
    }
  }

  if (!$SkipGam) {
    Write-AgentInfo "GAM komutları çalıştırılıyor..."
    "Running GAM commands..." | Tee-Object -FilePath $runLog -Append
    & cmd.exe /c "`"$gamFile`""
    if ($LASTEXITCODE -ne 0) {
      throw "GAM command file failed: $gamFile"
    }
  }

  if (!$SkipGam -and !$SkipSignatureCallback) {
    if ([string]::IsNullOrWhiteSpace($SignatureCallbackUrl) -or [string]::IsNullOrWhiteSpace($SignatureAgentSecret)) {
      "Signature status callback skipped. SIGNATURE_AGENT_SECRET or callback URL is empty." | Tee-Object -FilePath $runLog -Append
    } else {
      Write-AgentInfo "Zimmet sisteminde imza durumu güncelleniyor..."
      "Updating signature status in Zimmet backend..." | Tee-Object -FilePath $runLog -Append
      foreach ($row in $rows) {
        $signatureId = [string]$row.filename
        if ([string]::IsNullOrWhiteSpace($signatureId)) { continue }

        $payload = @{
          action = "completeSignatureJob"
          secret = $SignatureAgentSecret
          signatureId = $signatureId
          templateVariant = $templateVariant
          machine = $env:COMPUTERNAME
        } | ConvertTo-Json -Compress

        $callbackResponse = Invoke-RestMethod -Uri $SignatureCallbackUrl -Method Post -Body $payload -ContentType "application/json; charset=utf-8" -TimeoutSec 30
        if (!$callbackResponse.success) {
          throw "Signature status callback failed for ${signatureId}: $($callbackResponse.error)"
        }
        "Signature status updated: ${signatureId}" | Tee-Object -FilePath $runLog -Append
      }
    }
  }

  if ($SkipPhotoshop -or $SkipUpload -or $SkipGam -or $SkipSignatureCallback) {
    "Test mode detected. Input files were left in place." | Tee-Object -FilePath $runLog -Append
  } else {
    $processedDatasetDir = Join-Path $ProcessedDir "datasets"
    $processedCommandDir = Join-Path $ProcessedDir "commands"
    foreach ($dir in @($processedDatasetDir, $processedCommandDir)) {
      if (!(Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
      }
    }

    Move-Item -LiteralPath $dataset.FullName -Destination (Join-Path $processedDatasetDir $dataset.Name) -Force
    Move-Item -LiteralPath $gamFile -Destination (Join-Path $processedCommandDir (Split-Path $gamFile -Leaf)) -Force
  }

  Write-AgentInfo "Pipeline tamamlandı."
  "Pipeline completed." | Tee-Object -FilePath $runLog -Append
}
catch {
  $errorLog = Join-Path $LogDir ("pipeline_error_{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))
  $_ | Out-String | Tee-Object -FilePath $errorLog -Append
  throw
}
finally {
  Remove-Item -LiteralPath $LockFile -ErrorAction SilentlyContinue
}
