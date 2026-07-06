# Backend Startup Task

SQL API ve PDF worker ayni Node backend sureci icinde calisir. Canli kullanimda
backend'i elle PowerShell penceresinde acik birakmak yerine Windows gorevi olarak
calistirmek daha stabil olur.

Once backend `.env` dosyasinin hazir oldugunu ve elle calistigini dogrula:

```powershell
cd backend
npm install
npm start
```

Tarayicida kontrol:

```text
http://localhost:8787/health
```

Sessiz gorev kurmak/guncellemek:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Install-BackendStartupTask.ps1"
```

Varsayilan tetikleyici kullanici oturum acinca calisir. Bilgisayar acildiginda
baslamasini istersen:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Install-BackendStartupTask.ps1" -AtStartup
```

Varsayilan olarak gorev `wscript.exe` ile gizli calisir ve log yazar:

```text
C:\ZimmetBackend\backend.log
```

Test icin pencereyi gormek istersen:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Install-BackendStartupTask.ps1" -Visible
```

Not: Backend zaten calisiyorsa ikinci bir kopya port dolu hatasi verebilir. Once
eski terminali kapatip sonra gorevi baslatmak daha temizdir.
