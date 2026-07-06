# ISTEK Zimmet SQL API

Bu klasor, mevcut Apps Script `doPost` aksiyonlarini SQL Server tabanli yerel API'ye tasimak icin ilk iskelettir.

## Kurulum

```powershell
cd backend
copy .env.example .env
npm install
npm run dev
```

Frontend'i bu API'ye cevirmek icin kok projedeki `.env` dosyasina:

```env
VITE_API_URL=http://localhost:8787/api/action
```

yazin ve Vite server'i yeniden baslatin.

## Ilk Desteklenen Aksiyonlar

- `verifyLogin`
- `fetchData`
- `fetchHardwareHistory`
- `addHardware`, `updateHardware`, `bulkUpdateGroup`, `bulkStatusUpdate`
- `manualAssign`, `uploadMissingDocument`
- `fetchMissingGLPIDevices`, `importMissingGLPIDevices`
- `saveZimmetServerSide`, `returnZimmetServerSide`
- `startTransferServerSide`, `completeTransferServerSide`, `cancelTransfer`
- `createSheet` (Google Sheet yerine backend tarafinda XLSX dosyasi uretir)
- `enqueueADPasswordReset`, `fetchADPasswordQueue`
- `fetchSignatureMeta`, `createPersonnelSignature`

Frontend SQL API'ye cevrildiginde `VITE_API_URL` degeri bu API'nin `/api/action` adresini gostermelidir.

## SQL

Ilk sema:

```text
sql/001_create_schema.sql
```

Once test database'inde calistirin. Canliya gecmeden once Sheets verisi SQL'e aktarilmali ve `AuthorizedUsers`, `Campuses`, `Personnel`, `Hardware` tablolarinda temel veri kontrol edilmelidir.

Ek aksiyon tablolarini olusturmak icin:

```powershell
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\003_auxiliary_actions.sql
```

Bu script `SignatureTitles`, `SignatureJobs` ve `ADPasswordQueue` tablolarini acar ve `zimmet_api` kullanicisina gerekli CRUD izinlerini verir.

## Google Sheet Excel Aktarimi

Google Sheet dosyasini `.xlsx` olarak indirip repo disinda ya da `import-data/` altinda tutun. Bu klasor git'e alinmaz.

Ilk canli veri aktarimi icin:

```powershell
cd backend
npm install
npm run import:xlsx -- "..\import-data\zimmet-export.xlsx" --reset
```

`--reset` mevcut SQL test verisini silip Excel'deki `Kampüs`, `Yetkili_IT`, `Kullanıcılar`, `Laptoplar` ve `GLPI_Cihazlar` sayfalarini yeniden iceri alir.
Yeni import scripti `Ünvanlar` sayfasini da `SignatureTitles` tablosuna aktarir.

Transferlerde `Kullanıcı` alaninda `GÖNDEREN:...` metni tutuldugu icin `sql/002_allow_transfer_sender.sql` uyumluluk scripti de vardir. Import scripti bunu otomatik uygular.

## Export Dosyalari

`createSheet` aksiyonu artik Google Sheet olusturmak yerine XLSX dosyasi uretir. Uretilen dosya `/exports/...` altindan servis edilir.

Canli ortamda `.env` icinde `API_PUBLIC_URL` mutlaka HTTPS API adresi olmalidir:

```env
API_PUBLIC_URL=https://zimmet-api.example.org
GENERATED_EXPORT_DIR=C:\ZimmetApi\exports
```

## AD ve Imza Ajanlari

AD sifre sifirlama kuyrugu SQL'deki `ADPasswordQueue` tablosuna tasindi. Windows AD ajani artik SQL API'deki `fetchADPasswordJobs` ve `completeADPasswordJob` aksiyonlarini kullanir. Ornek ajan: `../ad/windows/Run-ADPasswordAgent.ps1`. Bunun icin backend `.env` icinde `AD_AGENT_SECRET`, ajan makinesinde de ayni secret tanimli olmalidir.

Imza olusturma istegi SQL'deki `SignatureJobs` tablosuna dusurulur ve personelin `Signature...` alanlari guncellenir. Windows Photoshop/GAM imza ajani `fetchSignatureJobs` ile SQL API'den is cekip `completeSignatureJob` ile sonucu geri yazar. Bunun icin backend `.env` icinde `SIGNATURE_AGENT_SECRET` veya gecis surecinde `AD_AGENT_SECRET` tanimli olmalidir.

## Personel Sync Agent

SQL API internete acilmayacaksa Apps Script `http://sunucu:8787` veya `localhost` adresine erisemez. Bu nedenle form / Google Admin scriptleri `Kullanıcılar` sheet'ini guncellemeye devam eder; kurum icindeki Windows agent ise veriyi Apps Script'ten cekip lokal SQL API'ye yazar.

Apps Script tarafina `../docs/personnel-sync-appscript-snippet.gs` icindeki `exportPersonnelForSync` handler'i eklenir ve Web App yeni surum olarak deploy edilir.

Apps Script Properties:

```text
PERSONNEL_SYNC_SECRET=backend .env ile ayni secret
```

Backend `.env`:

```env
PERSONNEL_SYNC_SECRET=ayni-secret
```

Windows agent ortam degiskenleri:

```powershell
[Environment]::SetEnvironmentVariable("PERSONNEL_EXPORT_URL", "https://script.google.com/macros/s/.../exec", "User")
[Environment]::SetEnvironmentVariable("PERSONNEL_SYNC_SECRET", "ayni-secret", "User")
[Environment]::SetEnvironmentVariable("ZIMMET_API_URL", "http://localhost:8787/api/action", "User")
```

Test:

```powershell
cd C:\Users\comert.yanar\Documents\Codex\2026-04-27\github-plugin-github-openai-curated-zimmet
.\sync-personnel.ps1 -DryRun
.\sync-personnel.ps1
```
