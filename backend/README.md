# ISTEK Zimmet SQL API

Bu klasör, mevcut Apps Script `doPost` aksiyonlarını SQL Server tabanlı yerel API'ye taşımak için ilk iskelettir.

## Kurulum

```powershell
cd backend
copy .env.example .env
npm install
npm run dev
```

Frontend'i bu API'ye çevirmek için kök projedeki `.env` dosyasına:

```env
VITE_API_URL=http://localhost:8787/api/action
```

yazin ve Vite server'i yeniden baslatin.

SQL geçici olarak erişilemezse reddedilen bağlantı havuzu sıfırlanır; sonraki
istek servisi yeniden başlatmadan tekrar bağlanmayı dener. Yazma sorguları otomatik
tekrar edilmez, böylece bağlantı belirsizliğinde çift kayıt üretilmez. Bağlantı ve
tek sorgu timeout değerleri:

```env
SQL_CONNECTION_TIMEOUT_MS=15000
SQL_REQUEST_TIMEOUT_MS=60000
```

## Ilk Desteklenen Aksiyonlar

- `verifyLogin`
- `fetchData`
- `fetchHardwareHistory`
- `addHardware`, `bulkAddHardware`, `updateHardware`, `bulkUpdateGroup`, `bulkStatusUpdate`
- `manualAssign`, `uploadMissingDocument`
- `fetchMissingGLPIDevices`, `importMissingGLPIDevices`
- `saveZimmetServerSide`, `returnZimmetServerSide`
- `startTransferServerSide`, `completeTransferServerSide`, `cancelTransfer`
- `createSheet` (Google Sheet yerine backend tarafında XLSX dosyası üretir)
- `enqueueADPasswordReset`, `fetchADPasswordQueue`
- `fetchSignatureMeta`, `createPersonnelSignature`

`fetchData`, bağımsız personel ve donanım sorgularını SQL havuzunda paralel çalıştırır.
Full/delta ile HQ/kampüs yolları ayrı sabit sorgu planları kullanır; böylece
`UpdatedAt` ve kampüs indeksleri `OR` bayrakları yüzünden devre dışı kalmaz. Kampüs
IT kullanıcısı, kendi görünür cihazına zimmetli başka kampüs personelinin yalnız
gerekli profil kaydını da gerçek adıyla alır.

Frontend SQL API'ye cevrildiginde `VITE_API_URL` degeri bu API'nin `/api/action` adresini gostermelidir.

## HttpOnly Oturum Cookie'si

Varsayılan durumda geriye dönük token oturumu çalışır. React build'i backend ile
aynı HTTPS domaininden sunulduğunda gerçek oturum anahtarını JavaScript ve
`localStorage` erişiminden çıkarmak için:

```env
SESSION_COOKIE_ENABLED=true
SESSION_COOKIE_NAME=__Host-istek_session
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=Lax
SESSION_COOKIE_DOMAIN=
SESSION_COOKIE_ALLOW_BODY_TOKEN_FALLBACK=false
```

Bu modda:

- Login yanıtında `sessionToken` frontend'e gönderilmez.
- Anahtar yalnız `HttpOnly` cookie olarak tutulur.
- Tüm API yanıtları `Cache-Control: no-store` kullanır.
- Logout ve 401 yanıtı cookie'yi temizler.
- Body içindeki eski token varsayılan olarak kabul edilmez.
- HTTP loglarında `Cookie`, `Authorization`, agent imzası ve `Set-Cookie` sansürlenir.
- Cookie taşıyan `Sec-Fetch-Site: cross-site` istekleri ayrıca reddedilir.

`__Host-` cookie adı için `Secure=true`, `Path=/` ve boş domain zorunludur; backend
bu koşulları başlangıçta doğrular. Yerel HTTP geliştirme denemesinde yalnız
`NODE_ENV=development` iken geçici olarak normal cookie adı ve `Secure=false`
kullanılabilir.

Frontend ve API farklı sitelerdeyse `SameSite=Lax` cookie gönderilmez. Güvenli ve
önerilen canlı kurulum `SERVE_FRONTEND=true` ile tek domain kullanmaktır. Eski
tokenlardan cookie'ye kısa geçiş kesinlikle gerekirse
`SESSION_COOKIE_ALLOW_BODY_TOKEN_FALLBACK=true` geçici olarak açılabilir; tüm
kullanıcılar yeniden giriş yaptıktan sonra tekrar `false` yapılmalıdır.

Cookie güvenlik akışını ana `8787` servisini veya iş kayıtlarını değiştirmeden test
etmek için:

```powershell
cd backend
npm run smoke:cookie
```

Komut boş bir yerel port seçer, cookie modunda geçici backend açar ve yalnız kısa
ömürlü bir SQL oturumu oluşturur. Body içindeki eski tokenın reddedildiğini,
HttpOnly cookie ile `fetchData` okunabildiğini, `Sec-Fetch-Site: cross-site`
isteğinin engellendiğini, logout sırasında cookie ile SQL oturumunun silindiğini ve
aynı anahtarın yeniden kullanılamadığını doğrular. Test sonunda kendi oturumunu ve
geçici backend sürecini temizler.

## SQL

Ilk sema:

```text
sql/001_create_schema.sql
```

Önce test database'inde çalıştırın. Canlıya geçmeden önce Sheets verisi SQL'e aktarılmalı ve `AuthorizedUsers`, `Campuses`, `Personnel`, `Hardware` tablolarında temel veri kontrol edilmelidir.

Ek aksiyon tablolarını oluşturmak için:

```powershell
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\003_auxiliary_actions.sql
```

Bu script `SignatureTitles`, `SignatureJobs` ve `ADPasswordQueue` tablolarını açar ve `zimmet_api` kullanıcısına gerekli CRUD izinlerini verir.

Yoğun kullanımda kuyruk, oturum ve kullanıcıya göre liste sorgularını hızlandıran indeksleri eklemek için bir kez çalıştırın:

```powershell
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\004_performance_indexes.sql
```

Migration tekrar çalıştırılabilir; mevcut indeksleri yeniden oluşturmaz.

Güvenlik, kuyruk lease, hash'li oturum, delta senkronizasyon ve log zinciri
migration'larını numara sırasıyla bir kez çalıştırın:

```powershell
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\005_security_hardening.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\006_queue_leases.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\007_session_token_hash.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\008_delta_sync_indexes.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\009_ad_queue_person_status_index.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\010_system_log_chain.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\011_agent_nonce_ledger.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\012_queue_retention.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\013_redact_final_operation_payloads.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\014_least_privilege_api_user.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\015_super_admin_console.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\016_personnel_contact_identity.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\017_queue_notification_dismissals.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\017_prune_personnel_sync_logs.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\018_signature_title_admin.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\019_finalize_pdf_history.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\020_signature_wide_templates.sql
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -C -f 65001 -b -i .\sql\021_merge_konyaalti_campuses.sql
```

`020_signature_wide_templates.sql`, mevcut veritabanlarında imza şablonu
anahtarlarını `1`, `1-w`, `2`, `2-w`, `3`, `3-w`, `4`, `4-w` olarak
genişletir. Temiz kurulumlarda aynı doğrulama `018_signature_title_admin.sql`
içinde de bulunur. Migration çalıştırıldıktan sonra backend ve imza ajanını
yeniden başlatın.

`021_merge_konyaalti_campuses.sql`, `Konyaaltı`, `Konyaaltı - İlkokul` ve
eski `Antalya Kampüsü (Konyaaltı)` kayıtlarını tek `Konyaaltı Kampüsü`
kaydında birleştirir. `Campuses` tablosuna yabancı anahtarla bağlı mevcut ve
sonradan eklenen tüm kayıtlar otomatik bulunup kanonik kampüse taşınır; yetkili
kullanıcı, personel, donanım, kuyruk, hesap ve öğrenci ilişkileri korunur.

`010_system_log_chain.sql`, mevcut logları SHA-256 zincirine dahil eder ve
`SystemLogs` tablosunu API için yalnızca eklenebilir hale getirir. Zincir kontrolü:

```sql
SELECT COUNT(*) AS BozukKayit
FROM dbo.vw_SystemLogChainVerification
WHERE IsValid = 0;
```

`011_agent_nonce_ledger.sql`, agent isteklerindeki nonce değerlerinin SHA-256
özetini kısa süreli olarak SQL Server'da tutar. Böylece backend yeniden başlasa
bile aynı imzalı istek tekrar çalıştırılamaz. `zimmet_api` kullanıcısı tabloyu
doğrudan okuyamaz veya değiştiremez; yalnızca atomik rezervasyon prosedürünü
çalıştırabilir.

`012_queue_retention.sql`, yalnız nihai durumdaki geçici PDF/GLPI, AD parola ve
imza kuyruk kayıtlarını partiler halinde temizleyen prosedürü ve indeksleri ekler.
Bekleyen/işlenen kayıtlar, `HardwareHistory` ve zincirli `SystemLogs` silinmez.
Backend varsayılan olarak temizliği altı saatte bir çalıştırır:

```env
QUEUE_CLEANUP_ENABLED=true
QUEUE_CLEANUP_INTERVAL_MS=21600000
OPERATION_QUEUE_RETENTION_DAYS=30
AD_QUEUE_RETENTION_DAYS=30
SIGNATURE_QUEUE_RETENTION_DAYS=30
QUEUE_CLEANUP_BATCH_SIZE=500
```

`013_redact_final_operation_payloads.sql`, daha önce tamamlanmış PDF kuyruk
kayıtlarındaki imza görselleri, OTP bilgisi, e-posta içeriği ve istemci verisini
güvenli cihaz/personel özetine indirir. Yeni işler uygulama tarafından başarıyla
tamamlandığı anda otomatik redakte edilir. Hatalı bir PDF işi yeniden denenebildiği
sürece tam payload korunur; son deneme hakkı bittiğinde aynı redaksiyon uygulanır.

`014_least_privilege_api_user.sql`, `zimmet_api` hesabını `db_owner`,
`db_datareader`, `db_datawriter` ve diğer sabit yüksek yetkili rollerden çıkarır.
API yalnız kullandığı tablolarda gerekli `SELECT/INSERT/UPDATE` izinlerini alır;
doğrudan `DELETE` yalnız oturum ve GLPI tam senkron tablolarında kalır. Kuyruk
saklama silmeleri yalnız `dbo.PruneZimmetTransientData` prosedürü üzerinden yürür.
Bu migration'dan sonra backend yeniden başlatılıp login, veri çekme, GLPI sync,
zimmet kuyruğu, AD ve imza agent akışları smoke test edilmelidir.

`015_super_admin_console.sql`, süper yönetici panelinin kullandığı dar yetkili
prosedürleri ve personel düzeltme katmanını ekler. Personelin kaynak kaydı
senkronizasyon tarafından güncellenmeye devam eder; yönetici kampüs/durum
düzeltmesi `vw_EffectivePersonnel` görünümünde uygulanır ve senkron tarafından
ezilmez. Süper yönetici ayrı bir veritabanı rolü değildir. Yalnız backend
sunucusundaki virgülle ayrılmış e-posta listesiyle etkinleştirilir:

```env
SUPER_ADMIN_EMAILS=comert.yanar@istek.k12.tr
```

Bu listedeki hesaplar ayrıca `AuthorizedUsers` tablosunda aktif olmalıdır.
Panel yalnız normal `IT` ve `HQ IT` erişimi dağıtır; süper yönetici yetkisi
arayüzden verilemez. Yetkili erişimi kapatıldığında o kullanıcının mevcut
oturumları da prosedür tarafından iptal edilir.

`016_personnel_contact_identity.sql`, personelin T.C. kimlik numarasını açık
metin olarak tutmak yerine yalnız HMAC-SHA256 özetini saklayan
`Personnel.NationalIdHash` kolonunu ve tekillik indeksini ekler. HMAC anahtarı
SQL veritabanında veya SQL yedeğinde tutulmaz.

`019_finalize_pdf_history.sql`, Google Drive ve e-posta tesliminden sonra cihaz
bağlantısı ile geçmiş kaydını tek ve dar yetkili bir prosedür üzerinden tamamlar.
API hesabının `HardwareHistory` tablosundaki doğrudan `UPDATE` reddi korunur.
PDF işçisi dış teslim sonucunu önce kuyrukta sakladığı için sonraki SQL adımı hata
verse bile yeniden deneme aynı dosyayı veya e-postayı ikinci kez üretmez.

`npm run import:xlsx -- --reset` çok sayıda tabloyu bilinçli olarak silip yeniden
oluşturduğu için en az yetkili API hesabıyla çalışmaz. İlk/toplu importu `014`
migration'ından önce tamamlayın veya import için ayrı, geçici yönetici bağlantısı
kullanın; günlük backend hesabına yeniden geniş yetki vermeyin.

Rol üyeliğini kontrol etmek için:

```sql
SELECT rolePrincipal.name AS RoleName
FROM sys.database_role_members membership
INNER JOIN sys.database_principals rolePrincipal
  ON rolePrincipal.principal_id = membership.role_principal_id
INNER JOIN sys.database_principals memberPrincipal
  ON memberPrincipal.principal_id = membership.member_principal_id
WHERE memberPrincipal.name = N'zimmet_api';
```

Canlı öncesi şema, log zinciri ve en düşük yetki matrisini backend'in gerçek
`.env` bağlantısıyla salt-okunur olarak doğrulamak için:

```powershell
cd backend
npm run verify:runtime
```

Komut eksik tablo/kolon/prosedür, yüksek yetkili sabit rol, beklenmeyen
`DELETE/UPDATE` izni veya bozuk log zinciri bulursa hata koduyla kapanır.

Google Drive/Gmail Apps Script köprüsünün URL ve anahtar eşleşmesini e-posta
göndermeden doğrulamak için:

```powershell
cd backend
npm run verify:google-bridge
```

Bu kontrol `.env` içindeki `GOOGLE_BRIDGE_URL` ve `GOOGLE_BRIDGE_SECRET`
değerlerini kullanır. Başarılı sonuç için aynı kodun Apps Script web uygulamasında
yeni sürüm olarak dağıtılmış olması gerekir.

Çalışan API'nin SQL bağlantısını, güvenlik başlıklarını, CORS politikasını,
istek doğrulamasını, oturum zorunluluğunu ve imzalı export korumasını veri
yazmadan kontrol etmek için:

```powershell
cd backend
npm run smoke:api
```

Başka bir pilot/canlı adresi doğrulamak için URL ortam değişkeni veya ilk argüman
olarak verilebilir:

```powershell
$env:API_BASE_URL = "https://zimmet.example.com"
npm run smoke:api

# veya
npm run smoke:api -- "https://zimmet.example.com"
```

Bu test gerçek zimmet, iade, transfer veya kuyruk kaydı oluşturmaz. Bilinmeyen
aksiyon, bozuk/aşırı derin JSON, prototype-pollution alanı, yetkisiz veri okuma,
güvenilmeyen Origin ve imzasız export isteği gönderip doğru HTTP reddini bekler.

Çalışan frontend'in oturumsuz giriş ekranını gerçek Chrome/Edge ile masaüstü ve
mobil boyutta doğrulamak için:

```powershell
cd backend
npm run smoke:ui
```

Test beyaz ekranı, React çalışma zamanı hatasını, Vite hata katmanını, yatay
taşmayı, kırpılmış/görünmeyen giriş düğmesini ve boş ekran çıktısını reddeder.
Gerçek Google hesabı seçmez ve uygulama verisi yazmaz. Başka bir adres için:

```powershell
$env:UI_BASE_URL = "https://zimmet.example.com"
npm run smoke:ui
```

Chrome otomatik bulunamazsa `PDF_CHROME_PATH` veya `CHROME_PATH` tanımlanmalıdır.

Yerel SQL'deki aktif bir yetkili üzerinden Donanım, Personel ve Transfer
sekmelerini oturumlu olarak test etmek için:

```powershell
cd backend
npm run smoke:ui:auth
```

Bu komut yalnız test süresince 15 dakikalık bir SQL oturumu oluşturur; gerçek
`fetchData` yanıtını desktop/mobil görünümde doğrular, üç ana sekmeyi açar ve
sonunda oluşturduğu oturumu SQL'den siler. Zimmet, iade, transfer, QR, imza veya
AD işi oluşturmaz. SQL bağlantısı ve çalışan yerel frontend gerektiği için GitHub
CI içinde değil, pilot/canlı güncelleme öncesi yerel sunucuda çalıştırılmalıdır.

Aynı-domain production build'ini HttpOnly cookie modunda gerçek tarayıcıyla test
etmek için:

```powershell
cd backend
npm run smoke:ui:cookie
```

Komut frontend'i geçici olarak `VITE_API_URL=/api/action` ile build eder, boş bir
portta `SERVE_FRONTEND=true` backend açar ve masaüstü/mobil görünümde gerçek SQL
verisini okur. Her görünümde sayfayı yeniler, Donanım/Personel/Transfer sekmelerini
açar, localStorage içinde yalnız gizli olmayan cookie oturum işaretinin kaldığını
ve HttpOnly cookie'nin `document.cookie` ile okunamadığını doğrular. Son olarak
Çıkış Yap akışıyla frontend kaydını, cookie'yi ve SQL oturumunu temizler. Gerçek
Google hesabıyla giriş yapmaz ve hiçbir iş kaydı oluşturmaz. Ayrıca yalnız test
için açılan ikinci SQL oturumunu süresi dolmuş hale getirir; yenilemedeki HTTP 401
sonrasında cookie/localStorage temizliğini, login ekranına dönüşü ve tarayıcı
`alert` penceresi yerine uygulamanın kendi “Oturum sona erdi” mesajını doğrular.

## HTTP Sınırları ve Statik Cache

Node sunucusu eksik/yavaş isteklerin bağlantıları süresiz tutmaması için açık
header, gövde ve keep-alive sınırları kullanır:

```env
HTTP_REQUEST_TIMEOUT_MS=120000
HTTP_HEADERS_TIMEOUT_MS=15000
HTTP_KEEP_ALIVE_TIMEOUT_MS=5000
HTTP_MAX_HEADERS_COUNT=100
HTTP_MAX_REQUESTS_PER_SOCKET=1000
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=600
API_RATE_LIMIT_MAX_BUCKETS=50000
```

Genel API sınırı IP başına varsayılan olarak dakikada 600 istektir ve JSON gövdesi
ayrıştırılmadan önce uygulanır. OTP, giriş ve agent işlemleri için daha dar aksiyon
bazlı sınırlar ayrıca korunur. Bucket tablosu üst sınırlandırıldığı için çok sayıda
farklı istemci adresi sunucu belleğini sınırsız büyütemez.

API yalnız tanımlı aksiyon adlarını kabul eder. JSON ağacının derinliği, toplam
karmaşıklığı, nesne/listelerin büyüklüğü ve kritik kimlik listeleri iş mantığından
önce doğrulanır; prototype-pollution alan adları reddedilir. Manuel belge yüklemeleri
kanonik Base64 olmalı, çözülmüş gerçek dosya boyutu 15 MB'ı geçmemeli ve PDF/JPG/PNG
magic-byte kontrolünü sağlamalıdır.

Toplu donanım işlemlerinde seçilen seri numaraları tek tek SQL parametresi olarak
gönderilmez; tek JSON paketi `OPENJSON` ile tabloya çevrilir. Böylece SQL Server'ın
2.100 parametre sınırı aşılmaz. Tek istekte en fazla 5.000 tekil cihaz kabul edilir;
daha büyük işlemler kontrollü partilere bölünmelidir.

Grup atama ile toplu depo/hurda işlemleri de cihaz başına ayrı `UPDATE` çalıştırmaz.
Tek set tabanlı güncelleme kullanılır; beklenen eski durum veya zimmet sahibi
değişmişse etkilenen satır sayısı tutmaz ve transaction bütünüyle geri alınır.
Depo/hurda geçmiş kayıtları aynı transaction içinde topluca yazılır.

QR sayım ekranındaki çoklu seçimler tek API isteği ve tek SQL transaction ile
kaydedilir. Aynı yetkilinin aynı cihazı 30 saniye içinde tekrar göndermesi mükerrer
geçmiş üretmez; SQL uygulama kilidi sayesinde eşzamanlı çift tıklamalar da
tekilleştirilir. Yanıtta eklenen ve atlanan cihaz sayıları ayrı döner.

HTTP erişim logları URL sorgu dizisini kaydetmez. Böylece `/exports/...` indirme
bağlantılarındaki kısa ömürlü `signature` ve `expires` değerleri loga düşmez.
Cookie, authorization, referrer ve agent HMAC başlıkları da `[REDACTED]` olarak
yazılır; istek gövdeleri erişim loguna eklenmez.

İşlem kuyruğu polling sorgusu tam PDF payload'ını Node'a taşımaz. SQL yalnız UI'nın
gerektirdiği cihaz/personel özetini ve sonuç alanlarını çıkarır; imza, OTP, e-posta
gövdesi ve istemci bilgisi backend belleğine veya API yanıtına alınmaz.

Tek-domain dağıtımında yalnız Vite'ın hash'li `assets/` dosyaları bir yıl
`immutable` cache alır. `sw.js`, `registerSW.js` ve web manifestleri her istekte
yeniden doğrulanır; böylece yeni sürüm yayınlandıktan sonra PWA eski service worker'a
takılı kalmaz. Üretim `/health` yanıtı SQL bağlantısının iç hata ayrıntısını dışarı
vermez; ayrıntı yalnız sunucu logunda kalır.

## SQL Yedekleme

SQL Server Express için günlük `COPY_ONLY + CHECKSUM` tam yedek, otomatik
`RESTORE VERIFYONLY` ve saklama temizliği Windows Görev Zamanlayıcı üzerinden
hazırlandı. Yönetici PowerShell ile:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Install-SqlBackupTask.ps1" -RunNow
```

Varsayılan olarak her gün `02:00`'de çalışır, yedekleri `C:\ZimmetBackup`
klasöründe tutar ve 30 günden eski, yalnız beklenen isim kalıbındaki yedekleri
temizler. Ayrıntılı kurulum, doğrulama ve geri yükleme tatbikatı:
`backend/windows/README.md`.

## PDF İşçisi

PDF işçisi tek bir görünmez Chrome/Edge sürecini yeniden kullanır. Varsayılan olarak
iki işi eşzamanlı yürütür; sunucunun RAM/CPU kapasitesi ölçülmeden `4` üzerine çıkmayın:

```env
PDF_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
PDF_CHROME_LAUNCH_TIMEOUT_MS=30000
PDF_RENDER_TIMEOUT_MS=45000
PDF_MAX_CONCURRENT_PAGES=2
QUEUE_MAX_JOBS_PER_RUN=2
QUEUE_WORKER_CONCURRENCY=2
```

## Personel T.C. ve Telefon Toplu Güncelleme

Bu işlem için Excel dosyasını doğrudan SSMS'e yapıştırmayın. İçe aktarma aracı:

- kişiyi yalnız `Google ID`, kurumsal e-posta veya `AD Kullanıcı` ile eşleştirir,
- ad-soyad benzerliğiyle hesap seçmez,
- T.C. doğrulama basamaklarını ve telefon biçimini kontrol eder,
- T.C. kimlik numarasını SQL'e açık metin olarak yazmaz,
- önce salt-okunur dry-run yapar,
- tüm güncellemeyi tek transaction içinde uygular.

Önce ayrı bir HMAC anahtarı üretin:

```powershell
$secret = [Convert]::ToHexString(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
).ToLower()
$secret
```

Çıktıyı `backend\.env` dosyasına ekleyin:

```env
PERSONNEL_ID_HMAC_SECRET=buraya-uretilen-uzun-deger
```

Bu anahtarı parola kasasında, SQL yedeğinden ayrı saklayın. Anahtar kaybolursa
mevcut T.C. özetleri yeni toplu dosyalarla karşılaştırılamaz. Anahtarı SQL
yedeğinin yanına düz metin olarak koymayın.

Ardından Windows yetkili hesabıyla migration'ı çalıştırın:

```powershell
cd C:\IstekZimmet\backend
sqlcmd -S localhost\SQLEXPRESS -d IstekZimmet -E -b -i .\sql\016_personnel_contact_identity.sql
```

`.xlsx` dosyasının ilk satırında aşağıdaki kolonlardan en az bir eşleştirme ve
en az bir veri kolonu bulunmalıdır:

| Amaç | Kabul edilen örnek başlıklar |
| --- | --- |
| Hesap eşleştirme | `Google ID`, `PersonId`, `User Id`, `Kurumsal E-Posta`, `AD Kullanıcı` |
| Kimlik/iletişim | `T.C. Kimlik No`, `TCKN`, `Telefon`, `Cep Telefonu` |

Birden fazla eşleştirme kolonu verilirse hepsinin aynı SQL personelini göstermesi
zorunludur. Telefonlar `5XXXXXXXXX`, `05XXXXXXXXX` veya `+905XXXXXXXXX`
biçiminde olabilir; SQL'e 10 hane olarak kaydedilir.

Önce dry-run çalıştırın:

```powershell
cd C:\IstekZimmet\backend
npm run import:personnel-contact -- "C:\Guvenli\personel-iletisim.xlsx"
```

Özet hatasızsa aynı dosyayı uygulayın:

```powershell
npm run import:personnel-contact -- "C:\Guvenli\personel-iletisim.xlsx" --apply
```

SQL'de dolu ve farklı bir telefon/T.C. özeti varsa araç işlemi durdurur. Bu
değerleri bilinçli olarak değiştirmek için önce dry-run, sonra açık
`--overwrite` onayı kullanın:

```powershell
npm run import:personnel-contact -- "C:\Guvenli\personel-iletisim.xlsx" --overwrite
npm run import:personnel-contact -- "C:\Guvenli\personel-iletisim.xlsx" --overwrite --apply
```

Kaynak dosyadaki geçersiz telefon veya T.C. satırlarını bilinçli olarak tamamen
atlayıp yalnız geçerli satırları aktarmak gerekiyorsa önce dry-run, sonra
`--skip-invalid --apply` kullanın. Bu seçenek yalnız kaynak biçim hatalarını
atlar; SQL hesap eşleşmesi, mükerrer kimlik ve mevcut değer çakışması gibi
güvenlik hatalarını atlamaz:

```powershell
npm run import:personnel-contact -- "C:\Guvenli\personel-iletisim.xlsx" --skip-invalid
npm run import:personnel-contact -- "C:\Guvenli\personel-iletisim.xlsx" --skip-invalid --apply
```

Çok sayfalı dosyada uygun birden fazla sayfa varsa `--sheet=SayfaAdı` ekleyin.
İşlem sonrası kaynak Excel'i yetkili ve şifreli konumda tutun veya kurumun veri
saklama politikasına göre güvenli biçimde kaldırın. Son olarak SQL yedeğini alın;
HMAC anahtarının parola kasası yedeğini ayrıca doğrulayın.

## Google Sheet Excel Aktarimi

Google Sheet dosyasını `.xlsx` olarak indirip repo dışında ya da `import-data/` altında tutun. Bu klasör git'e alınmaz.

İlk canlı veri aktarımı için:

```powershell
cd backend
npm install
npm run import:xlsx -- "..\import-data\zimmet-export.xlsx" --reset
```

`--reset` mevcut SQL test verisini silip Excel'deki `Kampüs`, `Yetkili_IT`, `Kullanıcılar`, `Laptoplar` ve `GLPI_Cihazlar` sayfalarini yeniden iceri alir.
Yeni import scripti `Ünvanlar` sayfasini da `SignatureTitles` tablosuna aktarir.

Transferlerde `Kullanıcı` alanında `GÖNDEREN:...` metni tutulduğu için `sql/002_allow_transfer_sender.sql` uyumluluk scripti de vardır. Import scripti bunu otomatik uygular.

## Export Dosyalari

`createSheet` aksiyonu `format` alanına göre iki güvenli çıktı üretir:

- `xlsx`: Başlığı kalın, ilk satırı sabitlenmiş, filtreli ve bantlı bir Excel çalışma kitabı oluşturur. İndirme bağlantısı HMAC ile imzalanır, bir saat geçerlidir ve eski geçici dosyalar 24 saat sonra otomatik temizlenir.
- `google-sheet`: Aynı biçimlendirilmiş tabloyu Google Apps Script köprüsü üzerinden oluşturur ve oturum açan kullanıcıya düzenleme yetkisi verir.

Boş `data` ile birlikte `templateHeaders` gönderildiğinde toplu içe aktarma için yalnız başlıkları bulunan biçimlendirilmiş bir XLSX şablonu üretilir.

Canlı ortamda geçici export klasörü `.env` içinde uygulama dizini dışında kalıcı bir konuma alınmalıdır:

```env
GENERATED_EXPORT_DIR=C:\ZimmetApi\exports
```

Google Sheets dışa aktarımı için Apps Script tarafındaki `Code.full.gs` yeniden dağıtılmalı; backend `.env` içindeki `GOOGLE_BRIDGE_URL` ve `GOOGLE_BRIDGE_SECRET` değerleri bu dağıtımla eşleşmelidir.

Cloudflare Tunnel veya başka bir reverse proxy kullanılıyorsa gerçek istemci IP'sinin sunucu tarafında güvenilir biçimde alınması için:

```env
TRUST_PROXY=true
```

Doğrudan internete açılan bir port varsa `TRUST_PROXY=false` bırakılmalıdır. Frontend artık üçüncü taraf IP servisine istek göndermez; log IP'si backend tarafından belirlenir.

## AD ve Imza Ajanlari

AD şifre sıfırlama kuyruğu SQL'deki `ADPasswordQueue` tablosuna taşındı. Windows AD ajanı artık SQL API'deki `fetchADPasswordJobs` ve `completeADPasswordJob` aksiyonlarını kullanır. Örnek ajan: `../ad/windows/Run-ADPasswordAgent.ps1`. Bunun için backend `.env` içinde `AD_AGENT_SECRET`, ajan makinesinde de aynı secret tanımlı olmalıdır.

İmza oluşturma isteği SQL'deki `SignatureJobs` tablosuna düşürülür ve personelin `Signature...` alanları güncellenir. Windows Photoshop/GAM imza ajanı `fetchSignatureJobs` ile SQL API'den iş çekip `completeSignatureJob` ile sonucu geri yazar. Bunun için backend `.env` içinde `SIGNATURE_AGENT_SECRET` veya geçiş sürecinde `AD_AGENT_SECRET` tanımlı olmalıdır.

Agent istekleri JSON gövdesinde secret taşımak yerine `X-Zimmet-Timestamp`, `X-Zimmet-Nonce` ve `X-Zimmet-Signature` başlıklarıyla HMAC-SHA256 olarak imzalanır. Güncel PowerShell agent dosyaları bunu otomatik yapar. Aynı istek ikinci kez gönderilemez ve varsayılan zaman toleransı 5 dakikadır:

```env
AGENT_AUTH_ALLOW_LEGACY=false
AGENT_AUTH_MAX_SKEW_SECONDS=300
```

Eski agentlara kısa bir geçiş süresi vermek zorunluysa `AGENT_AUTH_ALLOW_LEGACY=true` kullanılabilir; agentlar güncellendikten sonra tekrar `false` yapılmalıdır.

## Personel Sync Agent

SQL API internete açılmayacaksa Apps Script `http://sunucu:8787` veya `localhost` adresine erişemez. Bu nedenle form / Google Admin scriptleri `Kullanıcılar` sheet'ini güncellemeye devam eder; kurum içindeki Windows agent ise veriyi Apps Script'ten çekip lokal SQL API'ye yazar.

Apps Script tarafına `../docs/personnel-sync-appscript-snippet.gs` içindeki `exportPersonnelForSync` handler'i eklenir ve Web App yeni sürüm olarak deploy edilir.

Apps Script Properties:

```text
PERSONNEL_SYNC_SECRET=backend .env ile ayni secret
```

Backend `.env`:

```env
PERSONNEL_SYNC_SECRET=ayni-secret
```

Windows agent ortam değişkenleri:

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
