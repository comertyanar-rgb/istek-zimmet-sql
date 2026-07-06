# ISTEK Zimmet SQL

ISTEK demirbas/zimmet uygulamasinin SQL Server tabanli yeni surumu.

Bu repo su parcalari icerir:

- Vite/React frontend (`src/`)
- Yerel SQL Server API (`backend/`)
- SQL sema ve gecis scriptleri (`sql/`, `backend/sql/`)
- GLPI senkron PowerShell ajani (`sync-glpi.ps1`)
- Personel senkron PowerShell ajani (`sync-personnel.ps1`)
- Imza Photoshop/GAM ajani (`imza/windows/`)
- AD sifre sifirlama ajani (`ad/windows/`)
- Apps Script gecis/kopru kodlari (`Code.full.gs`, `*.gs`)

## Hizli Baslangic

Frontend:

```powershell
copy .env.example .env
npm install
npm run dev
```

Backend:

```powershell
cd backend
copy .env.example .env
npm install
npm run dev
powershell.exe -ExecutionPolicy Bypass -File ".\windows\Install-BackendStartupTask.ps1"
```

SQL API testinde frontend `.env` icinde:

```env
VITE_API_URL=http://localhost:8787/api/action
```

## SQL Server

Ilk sema:

```powershell
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\001_create_schema.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\002_allow_transfer_sender.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\backend\sql\003_auxiliary_actions.sql
```

Sheets export import:

```powershell
cd backend
npm run import:xlsx -- "..\import-data\zimmet-export.xlsx" --reset
```

`import-data/` git'e alinmaz.

## Gizli Bilgiler

Gercek secret ve sifreler repo'ya konmaz.

Ignore edilen dosyalar:

- `.env`
- `backend/.env`
- `node_modules/`
- `.npm-cache/`
- `dist/`
- `import-data/`
- `backend/generated-pdfs/`

Ornek ayarlar icin:

- `.env.example`
- `backend/.env.example`

## Agentlar

GLPI:

```powershell
.\sync-glpi.ps1
powershell.exe -ExecutionPolicy Bypass -File ".\glpi\windows\Install-GlpiSyncTask.ps1" -IntervalMinutes 30
```

Personel:

```powershell
.\sync-personnel.ps1 -DryRun
.\sync-personnel.ps1
powershell.exe -ExecutionPolicy Bypass -File ".\personnel\windows\Install-PersonnelSyncTask.ps1" -IntervalMinutes 5
```

Imza:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\GAMWork\scripts\Run-ImzaPipeline.ps1"
powershell.exe -ExecutionPolicy Bypass -File ".\imza\windows\Install-ImzaAgentTask.ps1" -IntervalMinutes 2
```

AD sifre sifirlama ajani SQL API'deki `fetchADPasswordJobs` ve
`completeADPasswordJob` aksiyonlariyla calisir:

```powershell
pwsh -ExecutionPolicy Bypass -File ".\ad\windows\Run-ADPasswordAgent.ps1" -WhatIfOnly -Limit 1
powershell.exe -ExecutionPolicy Bypass -File ".\ad\windows\Install-ADPasswordAgentTask.ps1" -IntervalMinutes 1
```

Kurulum ayrintisi: `ad/windows/README.md`

GLPI sync kurulum ayrintisi: `glpi/windows/README.md`

Personel sync kurulum ayrintisi: `personnel/windows/README.md`

Backend startup kurulum ayrintisi: `backend/windows/README.md`

Mevcut Windows gorevlerini denetlemek ve eski dogrudan PowerShell/Node calisan
gorevleri ayirt etmek icin:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\windows\Audit-ZimmetScheduledTasks.ps1"
```

Rapor `ESKI_ADAY` olarak isaretlediklerini once devre disi birakmak istersen:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\windows\Audit-ZimmetScheduledTasks.ps1" -DisableLegacy
```

## Dis Erisim / Cloudflare Tunnel

Mobil ve dis ag erisimi icin onerilen pilot yapi tek domain uzerinden calisir:

```text
https://zimmet.example.com
  -> Cloudflare Tunnel
  -> http://localhost:8787
     -> React dist
     -> /api/action SQL API
```

Bu yapi icin frontend build'i repo kokunde uretilir:

```powershell
npm run build
```

Backend `.env` canli testte su sekilde ayarlanir:

```env
NODE_ENV=production
API_PUBLIC_URL=https://zimmet.example.com
CORS_ORIGINS=https://zimmet.example.com
SERVE_FRONTEND=true
QUEUE_WORKER_ENABLED=true
```

Frontend `.env` icindeki API adresi ayni domaini gostermelidir:

```env
VITE_API_URL=https://zimmet.example.com/api/action
```

Google OAuth tarafinda ayni adres `Authorized JavaScript origins` listesine
eklenmelidir:

```text
https://zimmet.example.com
```

## Not

Canliya gecmeden once localde su akislari uctan uca test edin:

- Login
- Donanim/personel listesi
- GLPI senkron ve GLPI'dan donanima ekleme
- Zimmet/iade PDF kuyrugu
- Transfer
- QR sayim/depo/hurda
- AD sifre sifirlama
- Imza olusturma
