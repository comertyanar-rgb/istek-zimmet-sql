param(
  [string]$ApiUrl = "",
  [string]$AgentSecret = "",
  [string]$PrivateKeyPath = "",
  [int]$Limit = 5,
  [string]$DomainController = "",
  [switch]$WhatIfOnly
)

$ErrorActionPreference = "Stop"

function Get-Setting {
  param(
    [string]$Value,
    [string[]]$EnvNames,
    [string]$Default = ""
  )

  if (-not [string]::IsNullOrWhiteSpace($Value)) { return $Value }
  foreach ($name in $EnvNames) {
    $envValue = [Environment]::GetEnvironmentVariable($name, "Process")
    if ([string]::IsNullOrWhiteSpace($envValue)) {
      $envValue = [Environment]::GetEnvironmentVariable($name, "User")
    }
    if ([string]::IsNullOrWhiteSpace($envValue)) {
      $envValue = [Environment]::GetEnvironmentVariable($name, "Machine")
    }
    if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue }
  }
  return $Default
}

function Write-AgentLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$timestamp] $Message"
}

function Invoke-ZimmetApi {
  param([hashtable]$Payload)
  $json = $Payload | ConvertTo-Json -Depth 8
  $response = Invoke-RestMethod -Uri $script:ApiUrl -Method Post -ContentType "application/json; charset=utf-8" -Body $json
  if ($response.success -eq $false) {
    $message = [string]$response.error
    if ([string]::IsNullOrWhiteSpace($message)) {
      $message = "SQL API basarisiz yanit verdi."
    }
    throw $message
  }
  return $response
}

function Import-PrivateKey {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Private key dosyasi bulunamadi: $Path"
  }

  $pem = Get-Content -LiteralPath $Path -Raw
  $rsa = [System.Security.Cryptography.RSA]::Create()
  try {
    $rsa.ImportFromPem($pem)
  } catch {
    throw "RSA private key okunamadi. PowerShell 7+ ve PKCS#8 PEM kullanin. Hata: $($_.Exception.Message)"
  }
  return $rsa
}

function ConvertFrom-EncryptedPassword {
  param(
    [string]$Ciphertext,
    [System.Security.Cryptography.RSA]$Rsa
  )

  if ([string]::IsNullOrWhiteSpace($Ciphertext)) {
    throw "Sifreli parola bos."
  }

  $encryptedBytes = [Convert]::FromBase64String($Ciphertext)
  $plainBytes = $Rsa.Decrypt($encryptedBytes, [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256)
  return [System.Text.Encoding]::UTF8.GetString($plainBytes)
}

function Import-ADModule {
  try {
    Import-Module ActiveDirectory -ErrorAction Stop
  } catch {
    Import-Module ActiveDirectory -UseWindowsPowerShell -ErrorAction Stop
  }
}

function Set-DirectoryPassword {
  param(
    [object]$Job,
    [string]$PlainPassword
  )

  Import-ADModule

  $securePassword = ConvertTo-SecureString $PlainPassword -AsPlainText -Force
  $resetParams = @{
    Identity = $Job.adUser
    NewPassword = $securePassword
    Reset = $true
    ErrorAction = "Stop"
  }
  $userParams = @{
    Identity = $Job.adUser
    ErrorAction = "Stop"
  }

  if (-not [string]::IsNullOrWhiteSpace($script:DomainController)) {
    $resetParams.Server = $script:DomainController
    $userParams.Server = $script:DomainController
  }

  if ($script:WhatIfOnly) {
    Write-AgentLog "WHATIF: $($Job.adUser) icin AD sifresi degistirilecek. Mod: $($Job.mode)"
    return
  }

  Set-ADAccountPassword @resetParams
  $mustChange = ($Job.mode -eq "TEMPORARY")
  Set-ADUser @userParams -ChangePasswordAtLogon $mustChange
}

function Normalize-TrMobile {
  param([string]$Phone)
  $digits = ($Phone -replace "\D", "")
  if ($digits.StartsWith("0090")) { $digits = $digits.Substring(4) }
  if ($digits.StartsWith("90") -and $digits.Length -eq 12) { $digits = $digits.Substring(2) }
  if ($digits.StartsWith("0") -and $digits.Length -eq 11) { $digits = $digits.Substring(1) }
  if ($digits.Length -gt 10) { $digits = $digits.Substring(0, 10) }
  if ($digits -notmatch "^5\d{9}$") { throw "Gecersiz telefon numarasi: $Phone" }
  return $digits
}

function Send-MobildevSms {
  param(
    [string]$Phone,
    [string]$Message
  )

  $apiUrl = Get-Setting -EnvNames @("MOBILDEV_SMS_API_URL", "ZIMMET_MOBILDEV_SMS_API_URL") -Default "https://xmlapi.mobildev.com/"
  $apiKey = Get-Setting -EnvNames @("MOBILDEV_API_KEY", "ZIMMET_MOBILDEV_API_KEY")
  $apiSecret = Get-Setting -EnvNames @("MOBILDEV_API_SECRET", "ZIMMET_MOBILDEV_API_SECRET")
  $originator = Get-Setting -EnvNames @("MOBILDEV_ORIGINATOR", "ZIMMET_MOBILDEV_ORIGINATOR")

  if ([string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($apiSecret)) {
    throw "Mobildev ayarlari eksik."
  }

  $cleanPhone = Normalize-TrMobile $Phone
  $originatorXml = ""
  if (-not [string]::IsNullOrWhiteSpace($originator)) {
    $originatorXml = "<Originator>$([System.Security.SecurityElement]::Escape($originator))</Originator>"
  }

  $xml = @"
<MainmsgBody>
  <UserName>$([System.Security.SecurityElement]::Escape($apiKey))</UserName>
  <PassWord>$([System.Security.SecurityElement]::Escape($apiSecret))</PassWord>
  <Action>1</Action>
  <Messages>
    <Message>
      <Mesgbody><![CDATA[$Message]]></Mesgbody>
      <Number>$cleanPhone</Number>
    </Message>
  </Messages>
  $originatorXml
  <Blacklist>1</Blacklist>
  <Encoding>1</Encoding>
  <MessageType>N</MessageType>
</MainmsgBody>
"@

  $response = Invoke-WebRequest -Uri $apiUrl -Method Post -ContentType "application/xml; charset=utf-8" -Body $xml -UseBasicParsing
  $body = [string]$response.Content
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300 -or ($body.Trim() -notmatch "^(?i:id\s*:|\d+$)")) {
    throw "Mobildev SMS basarisiz: $($response.StatusCode) / $body"
  }
  return $body.Trim()
}

function Send-PasswordEmail {
  param(
    [string]$Email,
    [string]$PersonName,
    [string]$PlainPassword,
    [string]$Mode
  )

  $smtpServer = Get-Setting -EnvNames @("ZIMMET_SMTP_SERVER", "SMTP_SERVER")
  $smtpPort = [int](Get-Setting -EnvNames @("ZIMMET_SMTP_PORT", "SMTP_PORT") -Default "587")
  $smtpUser = Get-Setting -EnvNames @("ZIMMET_SMTP_USER", "SMTP_USER")
  $smtpPassword = Get-Setting -EnvNames @("ZIMMET_SMTP_PASSWORD", "SMTP_PASSWORD")
  $smtpUseSsl = (Get-Setting -EnvNames @("ZIMMET_SMTP_USE_SSL", "SMTP_USE_SSL") -Default "true") -match "^(1|true|yes|evet)$"
  $from = Get-Setting -EnvNames @("ZIMMET_NOTIFY_EMAIL_FROM", "SMTP_FROM") -Default $smtpUser

  if ([string]::IsNullOrWhiteSpace($smtpServer) -or [string]::IsNullOrWhiteSpace($from)) {
    throw "SMTP ayarlari eksik."
  }

  $modeText = if ($Mode -eq "TEMPORARY") { "Gecici" } else { "Kalici" }
  $subject = "Bilgisayar/Wi-Fi sifreniz degistirildi"
  $body = @"
Sayin $PersonName,

Bilgisayar/Wi-Fi sifreniz degistirildi.

Sifre tipi: $modeText
Yeni sifreniz: $PlainPassword

Bu islemi siz talep etmediyseniz lutfen Bilgi Islem birimiyle iletisime geciniz.
"@

  $mail = @{
    To = $Email
    From = $from
    Subject = $subject
    Body = $body
    SmtpServer = $smtpServer
    Port = $smtpPort
    UseSsl = $smtpUseSsl
    Encoding = "UTF8"
  }

  if (-not [string]::IsNullOrWhiteSpace($smtpUser) -and -not [string]::IsNullOrWhiteSpace($smtpPassword)) {
    $secure = ConvertTo-SecureString $smtpPassword -AsPlainText -Force
    $mail.Credential = [System.Management.Automation.PSCredential]::new($smtpUser, $secure)
  }

  Send-MailMessage @mail
}

function Send-OptionalNotifications {
  param(
    [object]$Job,
    [string]$PlainPassword
  )

  $messages = New-Object System.Collections.Generic.List[string]
  $modeText = if ($Job.mode -eq "TEMPORARY") { "Gecici" } else { "Kalici" }

  if ($Job.notifyEmail -and -not [string]::IsNullOrWhiteSpace($Job.personEmail)) {
    try {
      Send-PasswordEmail -Email $Job.personEmail -PersonName $Job.personName -PlainPassword $PlainPassword -Mode $Job.mode
      $messages.Add("E-posta gonderildi")
    } catch {
      $messages.Add("E-posta gonderilemedi: $($_.Exception.Message)")
    }
  }

  if ($Job.notifySms -and -not [string]::IsNullOrWhiteSpace($Job.notifyPhone)) {
    try {
      $smsMessage = "Bilgisayar/Wi-Fi sifreniz degistirildi. Tip: $modeText. Yeni sifreniz: $PlainPassword"
      Send-MobildevSms -Phone $Job.notifyPhone -Message $smsMessage | Out-Null
      $messages.Add("SMS gonderildi")
    } catch {
      $messages.Add("SMS gonderilemedi: $($_.Exception.Message)")
    }
  }

  return ($messages -join "; ")
}

$script:ApiUrl = Get-Setting -Value $ApiUrl -EnvNames @("ZIMMET_API_URL", "AD_AGENT_API_URL") -Default "http://localhost:8787/api/action"
$script:AgentSecret = Get-Setting -Value $AgentSecret -EnvNames @("AD_AGENT_SECRET", "ZIMMET_AD_AGENT_SECRET")
$script:PrivateKeyPath = Get-Setting -Value $PrivateKeyPath -EnvNames @("AD_RESET_PRIVATE_KEY_PATH", "ZIMMET_AD_PRIVATE_KEY_PATH") -Default "C:\ZimmetAD\ad-reset-private.pem"
$script:DomainController = Get-Setting -Value $DomainController -EnvNames @("AD_DOMAIN_CONTROLLER", "ZIMMET_AD_DOMAIN_CONTROLLER")

if ([string]::IsNullOrWhiteSpace($script:AgentSecret)) { throw "AD_AGENT_SECRET bos." }
if ($Limit -lt 1) { $Limit = 1 }
if ($Limit -gt 20) { $Limit = 20 }

Write-AgentLog "AD agent basladi. API: $script:ApiUrl Limit: $Limit"
$rsa = Import-PrivateKey -Path $script:PrivateKeyPath

$fetchResult = Invoke-ZimmetApi @{
  action = "fetchADPasswordJobs"
  secret = $script:AgentSecret
  limit = $Limit
}

$jobs = @($fetchResult.jobs)
if ($jobs.Count -eq 0) {
  Write-AgentLog "Bekleyen AD sifre isi yok."
  return
}

foreach ($job in $jobs) {
  $plainPassword = $null
  try {
    Write-AgentLog "Isleniyor: $($job.queueId) / $($job.adUser)"
    if ($job.encryptionAlg -ne "RSA-OAEP-SHA256") {
      throw "Desteklenmeyen sifreleme algoritmasi: $($job.encryptionAlg)"
    }

    $plainPassword = ConvertFrom-EncryptedPassword -Ciphertext $job.passwordCiphertext -Rsa $rsa
    Set-DirectoryPassword -Job $job -PlainPassword $plainPassword

    $notificationResult = Send-OptionalNotifications -Job $job -PlainPassword $plainPassword
    $resultMessage = "AD sifresi uygulandi."
    if (-not [string]::IsNullOrWhiteSpace($notificationResult)) {
      $resultMessage = "$resultMessage $notificationResult"
    }

    Invoke-ZimmetApi @{
      action = "completeADPasswordJob"
      secret = $script:AgentSecret
      queueId = $job.queueId
      success = $true
      result = $resultMessage
    } | Out-Null

    Write-AgentLog "Tamamlandi: $($job.queueId)"
  } catch {
    $errorMessage = $_.Exception.Message
    Invoke-ZimmetApi @{
      action = "completeADPasswordJob"
      secret = $script:AgentSecret
      queueId = $job.queueId
      success = $false
      error = $errorMessage
    } | Out-Null
    Write-AgentLog "HATA: $($job.queueId) / $errorMessage"
  } finally {
    if ($plainPassword) {
      $plainPassword = $null
      [System.GC]::Collect()
    }
  }
}
