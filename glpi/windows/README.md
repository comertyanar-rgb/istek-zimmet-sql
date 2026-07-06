# GLPI Sync Scheduled Task

Bu gorev GLPI'ye erisebilen ic ag bilgisayarinda calisir ve GLPI cihazlarini lokal SQL API'ye yollar.

Ortam degiskenleri daha once tanimli olmalidir:

```powershell
[Environment]::SetEnvironmentVariable("GLPI_APP_TOKEN", "...", "User")
[Environment]::SetEnvironmentVariable("GLPI_USER_TOKEN", "...", "User")
[Environment]::SetEnvironmentVariable("GLPI_SYNC_SECRET", "...", "User")
[Environment]::SetEnvironmentVariable("ZIMMET_API_URL", "http://localhost:8787/api/action", "User")
```

Sessiz gorev kurmak/guncellemek:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\glpi\windows\Install-GlpiSyncTask.ps1" -IntervalMinutes 30
```

Varsayilan olarak gorev `wscript.exe` ile gizli calisir. Test icin pencereyi gormek isterseniz:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\glpi\windows\Install-GlpiSyncTask.ps1" -IntervalMinutes 30 -Visible
```

Olusan wrapper:

```text
C:\ZimmetGLPI\Run-GlpiSyncHidden.vbs
```
