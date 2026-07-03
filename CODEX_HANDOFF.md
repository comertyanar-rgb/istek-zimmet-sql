# CODEX Handoff

## Current Goal

ISTEK Zimmet uygulamasini Google Sheets agirlikli yapidan yerel SQL Server + Node API yapisina kademeli olarak tasimak.

Mevcut odak:
- SQL API tarafina kalan islemleri tasimak.
- GLPI senkronunu SQL API'ye almak.
- Imza, AD sifre sifirlama ve PDF uretim gibi yan servisleri SQL kuyruk/agent modeliyle calistirmak.
- PDF uretimini Apps Script kotasindan uzaklastirip daha hizli/asenkron hale getirmek.
- GitHub'a ayrilan SQL repo uzerinden kontrollu commit/push akisini surdurmek.

## Files Changed

- `backend/src/config.js`
  - `GLPI_SYNC_SECRET` / `ZIMMET_SYNC_SECRET` destegi eklendi.
  - `SIGNATURE_AGENT_SECRET` / `ZIMMET_SIGNATURE_AGENT_SECRET` destegi eklendi.
  - Imza agent gecisinde mevcut secret ile test kolayligi icin `AD_AGENT_SECRET` fallback'i eklendi.

- `backend/src/actionRouter.js`
  - Oturum gerektirmeyen agent endpointleri eklendi:
    - `syncGLPI`
    - `fetchSignatureJobs`
    - `completeSignatureJob`

- `backend/src/repositories/inventoryRepository.js`
  - GLPI verisini SQL `GlpiDevices` tablosuna alan `syncGlpiDevicesFromAgent` eklendi.
  - GLPI verisi geldikten sonra `Hardware` tablosundaki GLPI alanlarini eslestiren reconcile akisi eklendi.
  - Imza agent kuyrugu icin `fetchSignatureAgentJobs` ve `completeSignatureAgentJob` eklendi.

- `sync-glpi.ps1`
  - Google Apps Script endpointi yerine SQL API endpointine POST edecek sekilde guncellendi.
  - Varsayilan endpoint: `http://localhost:8787/api/action`
  - Secret: once `GLPI_SYNC_SECRET`, yoksa `ZIMMET_SYNC_SECRET`.

- `imza/windows/Run-ImzaPipeline.ps1`
  - SQL API'den `fetchSignatureJobs` ile is cekme destegi eklendi.
  - Klasorde hazir dataset varsa once onu isler; yoksa SQL kuyrugundan is cekip dataset, HTML ve GAM dosyalarini yerelde uretir.
  - `completeSignatureJob` callback'i SQL API'ye donecek sekilde varsayilan URL mantigi eklendi.

- `imza/windows/README.md`
  - Yeni SQL imza agent calisma sekli ve gereken environment variable'lar dokumante edildi.

- `ad/windows/Run-ADPasswordAgent.ps1`
  - SQL API'deki `fetchADPasswordJobs` kuyruğundan is ceken Windows AD sifre ajani eklendi.
  - RSA-OAEP-SHA256 private key ile sifreyi yerelde cozer, AD'de uygular ve `completeADPasswordJob` ile sonucu geri yazar.
  - Opsiyonel e-posta/SMS bildirimini ajan tarafinda destekler.

- `ad/windows/README.md`
  - AD ajan kurulumu, environment variable'lar ve gorev zamanlayici ayarlari dokumante edildi.

- `backend/src/googleBridge.js`
  - `sendEmailThroughGoogleBridge` eklendi.

- `backend/src/otpService.js`
  - E-posta OTP artik Google Apps Script bridge uzerinden GmailApp ile gonderilir.

- `Code.full.gs`
  - `sendBridgeEmail` bridge aksiyonu eklendi.

## Important Decisions Made

- Uygulamanin ana veri kaynagi SQL Server olacak; Google Sheets artik kalici ana veritabani olarak dusunulmemeli.
- Google Apps Script simdilik Drive/Gmail/Google Admin gibi Google'a bagimli islerde kopru olarak kalabilir.
- GLPI dis internete kapali oldugu icin GLPI verisi ic agdaki PowerShell agent tarafindan SQL API'ye push edilecek.
- GLPI eslestirme onceligi:
  1. GLPI ID
  2. Seri no
  3. Bilgisayar ismi
- Agent endpointleri normal kullanici oturumu istemiyor; paylasilan secret ile korunuyor.
- AD private key dosyalari repoya alinmayacak; `.gitignore` icine `*.pem` ve `*.key` eklendi.
- SQL API e-posta OTP icin Gmail yetkisini direkt backend'e tasimiyor; Apps Script bridge uzerinden kullanmaya devam ediyor.
- SQL gecisi canliya alinmadan once localde her akis tek tek dogrulanacak.
- Bu klasor artik ayri Git repo olarak baslatildi ve `origin` `https://github.com/comertyanar-rgb/istek-zimmet-sql.git` adresine ayarlandi.

## Commands Already Run

SQL kurulum/import tarafinda daha once:

```powershell
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i backend\sql\003_auxiliary_actions.sql
```

Backend ve frontend icin daha once calisan kontroller:

```powershell
node --check src\server.js
node --check src\actionRouter.js
node --check src\repositories\inventoryRepository.js
node --check src\googleBridge.js
node --check scripts\import-sheets-xlsx.js
npm run build
```

Bu handoff olusturulmadan hemen once calistirilan kontroller:

```powershell
cd C:\Users\comert.yanar\Documents\Codex\2026-04-27\github-plugin-github-openai-curated-zimmet\backend
node --check src\config.js
node --check src\actionRouter.js
node --check src\repositories\inventoryRepository.js
```

Son kontrol sonucu: hata yok.

Son eklenen commitler:

```powershell
git log --oneline -3
# 4a7fb16 add google bridge email otp
# 1d3c17a add sql ad password agent
# ed675ea document sql repo setup
```

Kodda son eklenen agent actionlarini bulmak icin:

```powershell
rg -n "syncGlpiDevicesFromAgent|fetchSignatureAgentJobs|completeSignatureAgentJob|glpiSyncSecret|signatureAgentSecret|syncGLPI|fetchSignatureJobs|completeSignatureJob" backend\src\config.js backend\src\repositories\inventoryRepository.js backend\src\actionRouter.js sync-glpi.ps1 imza\windows\Run-ImzaPipeline.ps1
```

## Tests Passed Or Failed

Passed:
- `backend/src/config.js` syntax check
- `backend/src/actionRouter.js` syntax check
- `backend/src/repositories/inventoryRepository.js` syntax check
- `imza/windows/Run-ImzaPipeline.ps1` PowerShell parse check
- `fetchSignatureJobs` endpoint testi: kuyruk bostayken `success:true`, `leased:0` dondu.
- `ad/windows/Run-ADPasswordAgent.ps1` PowerShell parse check
- `npm run build`
- `backend/src/googleBridge.js` ve `backend/src/otpService.js` node syntax check
- PDF HTML template testi: ikinci sayfa yonerge var; `2.20299E+14` seri no HTML'de genisletilmis sekilde uretiliyor.
- `OperationQueue` SQL kontrolu: mevcut son durumda 2 PDF isi `TAMAMLANDI`, hata yok.
- Daha once `/health` endpointi SQL baglantisi icin `connected` donmustu.
- Daha once Sheet import tamamlandi.
- Daha once temel donanim islemleri, GLPI'dan donanima ekleme ve hurda/transfer denemeleri localde test edildi.

Failed / Known issues:
- `imza/windows/Run-ImzaPipeline.ps1` SQL API'den is cekmeye tasindi; uctan uca canli imza testi henuz yapilmadi.
- `sendBridgeEmail` icin Apps Script kodunun yeni surum olarak deploy edilmesi gerekir; deploy edilmeden production e-posta OTP eski /exec'te hata alabilir.
- AD ajani repoya eklendi ama gercek AD uzerinde uctan uca test henuz yapilmadi.
- PDF uretiminde yeni bridge formatinin eski iki sayfalik zimmet/iade PDF formatina birebir donmesi gerekiyor.
- Kuyruk popup/layer duzeni UI'da daha once toolbar arkasinda kalabiliyordu; son durum tekrar gorsel test edilmeli.

## Remaining TODOs

1. Imza SQL agent akisini uctan uca test et:
   - backend calisirken siteden imza olustur
   - `Run-ImzaPipeline.ps1` calistir
   - JPG, HTML upload, GAM ve SQL `Basıldı` durumunu kontrol et
2. GLPI sync'i SQL API'ye kucuk payload ile tekrar test et.
3. `SIGNATURE_AGENT_SECRET` ve `GLPI_SYNC_SECRET` degerlerinin backend `.env` ve ilgili Windows agent ortamlarinda ayni oldugunu dogrula.
4. PDF worker/bridge'in eski iki sayfalik zimmet ve iade PDF HTML formatini kullandigini dogrula.
5. Zimmet/iade PDF kuyruk islemini uctan uca test et:
   - OTP
   - SQL kaydi
   - PDF worker
   - Google Drive upload
   - Drive linkinin SQL'e yazilmasi
   - e-posta bildirimi
6. AD sifre sifirlama agent akisini SQL API tarafina tamamen bagli olarak tekrar test et.
7. QR sayim/depo/hurda islemlerinin SQL tarafinda anlik UI geri bildirimiyle calistigini tekrar test et.
8. Canliya gecmeden once Vercel/production CORS, API URL ve secret stratejisini netlestir.
9. GitHub repo push edildi; bundan sonraki degisiklikler normal commit/push akisiyle ilerleyecek.
10. Apps Script `Code.full.gs` yeni surum deploy edilecek; `sendBridgeEmail` ve `uploadGeneratedPdf` ayni `GOOGLE_BRIDGE_SECRET` ile calisacak.

## Exact Next Command To Continue

```powershell
cd C:\Users\comert.yanar\Documents\Codex\2026-04-27\github-plugin-github-openai-curated-zimmet\backend; npm run dev
```

Ardindan ayri bir PowerShell penceresinde GLPI sync testine devam etmek icin:

```powershell
cd C:\Users\comert.yanar\Documents\Codex\2026-04-27\github-plugin-github-openai-curated-zimmet; .\sync-glpi.ps1
```

## Latest Continuation - 2026-07-03

Eklenen commitler:

```powershell
# c5a9790 show signature jobs in operation queue
# 42c83b6 improve pdf queue result display
# 1da7dc6 fix mobildev success response in ad agent
```

Bu devamda yapilanlar:
- PDF kuyrugu tamamlandiginda donanim gecmisine islem tipine gore daha acik kayit yaziliyor: Zimmet/Iade/Transfer PDF Belgesi Olusturuldu.
- PDF kuyrugu sonucuna documentStatus ve url eklendi.
- Islem Kuyrugu panelinde tamamlanan PDF isleri icin Ac linki gosteriliyor.
- SQL API'ye kullanici oturumuyla okunabilen fetchSignatureQueue aksiyonu eklendi.
- Islem Kuyrugu paneli artik PDF, AD sifre ve Imza olusturma islerini tek yerde gosteriyor.

Calisan kontroller:

```powershell
node --check .\backend\src\pdfQueueWorker.js
node --check .\backend\src\repositories\inventoryRepository.js
node --check .\backend\src\actionRouter.js
npm run build
```

Notlar:
- Build basarili; sadece Vite buyuk chunk uyarisi var.
- Code.full.gs yeni Apps Script surumu olarak deploy edilmezse sendBridgeEmail / uploadGeneratedPdf koprusu production tarafinda eski kalabilir.

Siradaki en mantikli test:

```powershell
cd C:\Users\comert.yanar\Documents\Codex\2026-04-27\github-plugin-github-openai-curated-zimmet\backend
npm run dev
```

Ayri pencerede imza agent testi:

```powershell
cd C:\Users\comert.yanar\Documents\Codex\2026-04-27\github-plugin-github-openai-curated-zimmet
pwsh -ExecutionPolicy Bypass -File .\imza\windows\Run-ImzaPipeline.ps1
```
