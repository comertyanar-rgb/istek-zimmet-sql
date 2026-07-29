[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
  [string]$TaskName = "ISTEK Zimmet SQL Backup"
)

$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  [pscustomobject]@{
    success = $true
    taskName = $TaskName
    removed = $false
    message = "Gorev zaten bulunmuyor."
  }
  return
}

if ($PSCmdlet.ShouldProcess($TaskName, "Scheduled Task kaydini kaldir")) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  [pscustomobject]@{
    success = $true
    taskName = $TaskName
    removed = $true
    message = "Yalnizca gorev kaydi kaldirildi; backup dosyalarina dokunulmadi."
  }
}
