# GLPI Sync Scheduled Task

Bu gorev GLPI'ye erisebilen ic ag bilgisayarinda calisir ve GLPI cihazlarini lokal SQL API'ye yollar.

Ortam degiskenleri daha once tanimli olmalidir:

```powershell
[Environment]::SetEnvironmentVariable("GLPI_APP_TOKEN", "...", "User")
[Environment]::SetEnvironmentVariable("GLPI_USER_TOKEN", "...", "User")
[Environment]::SetEnvironmentVariable("GLPI_SYNC_SECRET", "...", "User")
[Environment]::SetEnvironmentVariable("ZIMMET_API_URL", "http://localhost:8787/api/action", "User")
```

Sunucuda gorev `SYSTEM` hesabi ile calisacaksa ayni degerleri `Machine` kapsaminda
tanimlayin. Token ve secret degerlerini komut gecmisinde acik birakmamak icin
etkilesimli gizli giris kullanin.

Sessiz gorev kurmak/guncellemek:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\glpi\windows\Install-GlpiSyncTask.ps1" -IntervalMinutes 30
```

Windows Server icin onerilen kurulum:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\glpi\windows\Install-GlpiSyncTask.ps1" `
  -IntervalMinutes 30 `
  -RunnerPath "E:\IstekZimmet\Run-GlpiSyncTask.ps1" `
  -LogPath "E:\IstekZimmet\Logs\glpi-sync.log" `
  -AtStartup `
  -RunAsSystem `
  -RunNow
```

Varsayilan olarak gorev gizli calisir. Test icin pencereyi gormek isterseniz:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\glpi\windows\Install-GlpiSyncTask.ps1" -IntervalMinutes 30 -Visible
```

Sunucuda durum kontrolu:

```powershell
Get-ScheduledTask -TaskName "ISTEK Zimmet GLPI Sync"
Get-ScheduledTaskInfo -TaskName "ISTEK Zimmet GLPI Sync"
Get-Content "E:\IstekZimmet\Logs\glpi-sync.log" -Tail 40
```
