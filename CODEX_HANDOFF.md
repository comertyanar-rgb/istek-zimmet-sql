# CODEX Handoff

## Current Goal

İSTEK Zimmet uygulamasını SQL Server + Node API mimarisinde güvenli, hızlı ve yoğun dönem kullanımına hazır hale getirmek. Google Apps Script yalnızca Drive/Gmail/Google Admin köprüsü olarak kalıyor; ana veri kaynağı SQL Server.

Son odak:
- Delta veri senkronizasyonu ve frontend sorgu maliyetlerini azaltmak.
- GLPI/personel senkronlarını set tabanlı SQL işlemlerine çevirmek.
- PDF kuyruğunu tek Chrome süreci ve sınırlı paralellik ile hızlandırmak.
- Oturum, OTP, agent ve SQL log güvenliğini sıkılaştırmak.
- Toplu durum işlemlerinde zimmet verisinin sessizce silinmesini engellemek.
- API isteklerini aksiyon bazlı doğrulamak ve kuyruk polling'inde hassas PDF
  payload'larını SQL dışına taşımamak.
- Kontrollü toplu iş testiyle 12 sentetik cihaz üzerinde grup, QR sayım, hurda/depo,
  SMS OTP, zimmet, e-posta OTP, iade, PDF/Drive/e-posta ve otomatik temizliği doğrulamak.

## Files Changed

Başlıca dosyalar:

- `backend/src/repositories/inventoryRepository.js`
  - Delta fetch, set tabanlı personel/GLPI sync, AD kuyruk tekrar engeli.
  - Toplu donanım seçimleri seri numarası başına SQL parametresi üretmek yerine
    tek `OPENJSON` paketi kullanır; 2.100 parametre sınırına takılmaz ve istek başına
    en fazla 5.000 tekil cihaz kabul edilir.
  - Toplu grup ve depo/hurda işlemleri cihaz başına ayrı sorgu yerine tek set tabanlı
    `UPDATE` kullanır; optimistic concurrency sayım kontrolü ve cihaz geçmişi aynı
    transaction içinde korunur.
  - Çoklu QR sayımı cihaz başına HTTP/transaction yerine tek batch çalışır. Aynı
    yetkilinin aynı cihazı 30 saniye içinde yeniden göndermesi SQL uygulama kilidiyle
    atomik olarak tekilleştirilir.
  - `fetchData` personel/donanım sorgularını paralel çalıştırır; HQ/kampüs ve
    full/delta sorgu dalları indeks dostudur. Kampüs dışındaki personel yalnız
    yetkilinin görünür cihazına zimmetliyse gerçek profiliyle gönderilir.
  - AD agent tamamlamasında lease sahipliği doğrulaması; sıfır satırlık güncelleme artık başarı sayılmaz.
  - Toplu durum işlemlerinde transfer engeli ve açık zimmet kaldırma onayı.
  - SHA-256 zincirli sistem logu yazımı.
  - Personel sync uyarı detayı sınırı ve toplam uyarı metriği.
  - İşlem kuyruğu listesi tam PDF payload'ı yerine SQL'de çıkarılan güvenli
    personel/donanım özetini okur; imza ve OTP verisi polling sırasında taşınmaz.
- `backend/src/requestValidation.js`, `backend/src/uploadedFileValidation.js`
  - Bilinen aksiyon allowlist'i, JSON derinlik/karmaşıklık ve liste sınırları,
    prototype-pollution alan reddi, kanonik Base64 ve gerçek 15 MB dosya sınırı.
- `backend/scripts/verify-runtime.js`
  - Gerçek API SQL hesabıyla şema nesneleri, migration kolonları, en düşük yetki
    matrisi ve güncel 7.902 satırlık log zincirini salt-okunur doğrular.
- `backend/src/pdfRenderer.js`
  - Her PDF için Chrome açmak yerine `puppeteer-core` ile tek tarayıcı süreci.
  - En fazla iki paralel sayfa, render timeout, dış ağ isteği engeli ve çökme sonrası yeniden başlatma.
- `backend/src/pdfQueueWorker.js`
  - Sınırlı paralel işçi havuzu, lease koruması ve kontrollü durdurma.
- `backend/src/server.js`, `backend/src/db.js`
  - Kontrollü servis kapanışı; PDF işçisi, Chrome ve SQL pool temizliği.
  - Opsiyonel HttpOnly cookie oturumu, `no-store` API yanıtları ve hassas header log sansürü.
  - HTTP header/request/keep-alive sınırları, üretim health hata sansürü ve PWA'ya uygun statik cache politikası.
  - Erişim logu URL sorgu dizisini kaydetmez; imzalı export anahtarları ile cookie,
    authorization, referrer ve agent HMAC başlıkları logdan sansürlenir.
  - Başarısız SQL bağlantısından sonra pool sıfırlama ve sonraki istekte güvenli yeniden bağlanma.
- `backend/src/sessionCookie.js`
  - Doğrulamalı cookie ayrıştırma/serileştirme; Secure, SameSite ve `__Host-` kuralları.
- `backend/src/server.js`, `backend/src/sessionService.js`
  - API geneli için JSON ayrıştırmadan önce IP bazlı trafik sınırı, sınırlı bucket
    belleği ve yalnız sistemin ürettiği Base64URL oturum anahtarı biçiminin kabulü.
- `backend/src/actionRouter.js`, `backend/src/sessionService.js`, `backend/src/otpService.js`, `backend/src/agentAuth.js`
  - Oturum hash'i, işlem bağlamlı tek kullanımlık OTP, HMAC agent doğrulaması ve replay engeli.
  - OTP kodu bellekte düz metin yerine HMAC özetiyle tutulur; personel bazlı cooldown
    cihaz listesi/kanal değiştirilerek aşılamaz ve bir personelin tek aktif kodu olur.
  - Yetki/oturum SQL'de her istekte doğrulanırken `LastSeenAt` yazımı token başına
    beş dakikada birleştirilerek gereksiz SQL write roundtrip'leri azaltılır.
- `backend/src/googleAuth.js`
  - Google token boyut/biçim sınırı, ID token issuer-subject doğrulaması ve access token
    audience/expiry/e-posta tutarlılığı kontrolleri.
- `backend/src/agentNonceStore.js`
  - Ham nonce yerine SHA-256 özetiyle SQL tabanlı atomik replay rezervasyonu.
- `src/App.jsx`, `src/components/OperationQueueIndicator.jsx`
  - Delta merge, ortak kuyruk polling store'u, O(1) cihaz/personel map'leri.
  - Toplu depo/hurda işlemlerinde zimmet kaldırma uyarısı.
  - Büyük sessionStorage snapshot yazımı idle zamana ertelenir; son yazım birleştirilir,
    logout'ta iptal edilir ve cache kota hatası ana veri çekimini başarısız yapmaz.
- `src/services/uiMessageService.js`, `src/components/AppMessageCenter.jsx`, `src/main.tsx`
  - Tarayıcı `alert/confirm` pencereleri yerine portal tabanlı, erişilebilir uygulama mesaj kuyruğu.
  - Hata, uyarı, bilgi ve başarı görünümleri; aynı oturum uyarısını tekilleştirme.
- `src/utils/safeUrls.js`, `src/App.jsx`, `src/components/OperationQueueIndicator.jsx`,
  `src/components/SignatureCreateModal.jsx`
  - Dinamik bağlantılarda yalnız HTTP(S), güvenli yeni sekme açma ve yalnız Google
    Drive için iframe önizlemesi; `javascript:`/kimlik bilgili URL'ler reddedilir.
- `src/services/apiClient.js`, `src/App.jsx`, `src/components/OperationQueueIndicator.jsx`
  - Cookie credential gönderimi, cookie modunda localStorage için gizli olmayan oturum işareti
    ve kullanıcı e-postasına göre ayrıştırılmış kuyruk store anahtarı.
- `src/index.css`, `src/components/LoadingSkeletons.jsx`, `src/App.jsx`
  - Ortak 140-320 ms hareket dili, ilk açılış/lazy/GLPI skeleton ekranları, sekme
    geçişleri, güncellenen donanım/personel satırı ve durum çipi vurgusu.
  - `prefers-reduced-motion` desteği tüm animasyon ve geçişleri erişilebilir biçimde kapatır.
- `src/components/QrScanTab.jsx`, `src/components/OperationQueueIndicator.jsx`
  - QR çerçevesi + son cihaz kartı geri bildirimi, ses kaynağı temizliği ve kuyruk
    durumlarına bağlı bekleme/işleme/tamamlandı/hata aşama çizgileri.
- `src/App.jsx`, modal bileşenleri
  - Bekleyen transfer rotasında durum çizgisi; donanım/personel/AD/imza/iade/QR ve
    uygulama mesajı modallarında ortak backdrop/panel geçişi.
- `src/components/HardwareProfileModal.jsx`
  - Tekil depo/hurda işleminde zimmet kaldırma uyarısı, açık onay bayrağı ve uygulama içi hata mesajları.
- `src/components/OtpVerification.jsx`
  - OTP doğrulama hataları tarayıcı penceresi yerine merkezi uygulama mesajını kullanır.
- `sync-personnel.ps1`
  - Toplam uyarı sayısını koruyup ayrıntıları 200 kayıtla sınırlar.
- `backend/test/*.test.js`
  - Agent HMAC/replay, telefon normalizasyonu, iki sayfalı PDF ve HTML escaping testleri.
- `backend/scripts/smoke-api.js`, `backend/package.json`
  - Çalışan API üzerinde veri yazmadan health/SQL, Helmet başlıkları, bozuk ve
    tehlikeli JSON, aksiyon allowlist'i, oturum, CORS, export imzası ve 404
  davranışını doğrulayan canlı smoke komutu (`npm run smoke:api`).
- `backend/scripts/smoke-business-bulk.js`, `backend/src/otpService.js`
  - Gerçek kurumsal veriye dokunmadan `CODEX-BULK-*` sentetik cihazlarla toplu iş
    akışını sınar ve Windows kimlik doğrulamasıyla test kayıtlarını geri temizler.
  - Gerçek SMS/e-posta teslimi sürerken OTP yalnız `NODE_ENV=test` ve
    `OTP_TEST_CAPTURE_ALLOWED=YES` birlikteyse aynı test sürecinin belleğinde
    yakalanabilir; HTTP yanıtına, dosyaya veya loga yazılmaz ve üretimde kapalıdır.
- `backend/scripts/smoke-ui.js`
  - Oturumsuz login ekranını gerçek Chrome/Edge ile 1440x900 ve 390x844
    boyutlarında açar; beyaz ekran, React/Vite hatası, yatay taşma ve kırpılmış
    giriş düğmesini veri yazmadan denetler (`npm run smoke:ui`).
- `backend/scripts/smoke-ui-authenticated.js`
  - Aktif bir yetkili için kısa ömürlü SQL test oturumu oluşturur; gerçek
    `fetchData` ile Donanım/Personel/Transfer sekmelerini desktop ve mobilde açar,
    ardından yalnız oluşturduğu oturumu doğrulayarak siler (`npm run smoke:ui:auth`).
- `backend/scripts/smoke-cookie-session.js`, `backend/test/sessionCookie.test.js`
  - Ana `8787` servisine dokunmadan boş bir portta cookie modlu backend açar;
    body-token reddi, HttpOnly cookie okuması, cross-site engeli, logout ve SQL
    oturum temizliğini gerçek veritabanıyla doğrular (`npm run smoke:cookie`).
  - Cookie serileştirme, temizleme, ayrıştırma, SameSite/Secure ve `__Host-`
    kuralları birim testleriyle korunur.
- `backend/scripts/smoke-ui-cookie.js`
  - Frontend'i `/api/action` hedefiyle production build eder ve boş bir portta
    aynı-domain cookie modlu backend üzerinden gerçek Chrome/Edge ile açar.
  - Desktop/mobil veri okuma, sayfa yenileme, ana sekmeler, localStorage'da yalnız
    oturum işareti bulunması, HttpOnly görünmezliği ve logout sonrası frontend,
    cookie ve SQL oturum temizliğini doğrular (`npm run smoke:ui:cookie`).
  - İkinci geçici SQL oturumunu kontrollü biçimde sona erdirip HTTP 401 sonrası
    login ekranına dönüşü, cookie/localStorage temizliğini ve uygulama içi uyarıyı
    yerel browser dialogu açılmadan doğrular.
- `.github/workflows/ci.yml`
  - Push/PR üzerinde salt-okunur repo yetkisiyle frontend lint/build/audit ve
    backend syntax/test/audit çalıştırır; SQL veya gerçek iş akışı tetiklemez.
- `backend/sql/004_performance_indexes.sql` ... `011_agent_nonce_ledger.sql`
  - Performans indeksleri, hassas veri temizliği, queue lease, session hash, delta indeksleri, AD tekrar engeli, append-only log zinciri ve kalıcı agent nonce ledger.
- `backend/sql/012_queue_retention.sql`, `backend/src/queueRetentionWorker.js`
  - Nihai durumdaki geçici kuyrukları küçük partilerle temizler; bekleyen/işlenen işler,
    cihaz geçmişi ve sistem logları korunur.
  - Filtreli indekslerin `sqlcmd` altında da güvenli kurulması için gerekli SQL
    `SET` seçenekleri açıkça tanımlıdır.
- `backend/src/queuePayloadSanitizer.js`, `backend/sql/013_redact_final_operation_payloads.sql`
  - Tamamlanan veya son yeniden denemesinde kalan PDF kuyruk payload'larını güvenli
    cihaz/personel özetine indirir; imza, OTP, e-posta gövdesi ve istemci verisi silinir.
- `backend/sql/014_least_privilege_api_user.sql`
  - `zimmet_api` hesabını yüksek yetkili sabit rollerden çıkarır; tablo bazlı en düşük
    yetkileri verir ve kuyruk/geçmiş/ana veri tablolarında doğrudan silmeyi engeller.
- `backend/.env.example`, `backend/README.md`
  - PDF concurrency/timeout ayarları ve migration komutları.
- `backend/windows/Backup-IstekZimmet.ps1`, `Verify-IstekZimmetBackup.ps1`,
  `Install-SqlBackupTask.ps1`, `Remove-SqlBackupTask.ps1`
  - SQL Express için günlük tam yedek, checksum doğrulama, güvenli saklama temizliği
    ve sessiz Windows görevi kurulumu.
  - Windows PowerShell 5.1 + Türkçe kültürde ASCII `I` regex hatasını önleyen
    case-sensitive parametre doğrulaması ve başarılı sqlcmd stderr mesajlarını
    `$LASTEXITCODE` ile değerlendiren uyumluluk düzeltmesi.
- `backend/windows/Test-IstekZimmetRestore.ps1`
  - En güncel yedeği benzersiz geçici veritabanına restore eder; `DBCC CHECKDB`,
    temel tablo sayıları ve log zincirini doğrular, sonra yalnız kendi oluşturduğu
    test veritabanını temizler. Mevcut veritabanında `REPLACE` kullanmaz.
- `package-lock.json`, `backend/package-lock.json`
  - Güvenlik düzeltmeli bağımlılıklar; Vite 7.3.6, PostCSS 8.5.16 ve Puppeteer Core.

Çalışma ağacı uzun geçiş sürecinden kalan başka değişiklikler de içeriyor. İlgisiz dosyaları geri alma.

## Important Decisions Made

- SQL Server tek ana veri kaynağıdır; Sheets yalnızca geçiş/senkron köprüsüdür.
- PDF HTML şablonları mevcut iki sayfalı zimmet/iade yönergesini korur.
- Gmail/Drive gönderimi Apps Script bridge üzerinden devam eder.
- PDF render Node tarafında yapılır ve aynı görünmez Chrome süreci yeniden kullanılır.
- Agent istekleri ayrı secret + timestamp + nonce + HMAC-SHA256 kullanır.
- Agent nonce'larının yalnızca SHA-256 özeti SQL'de kısa süreli tutulur; API yeniden başlasa bile replay kabul edilmez.
- `zimmet_api`, nonce tablosuna doğrudan erişemez; yalnız atomik rezervasyon prosedürünü çalıştırabilir.
- Session token SQL'de açık tutulmaz; SHA-256 hash ile aranır.
- Sistem logları SHA-256 zincirlidir; API hesabı eski logları güncelleyemez veya silemez.
- Zimmetli cihaz toplu olarak depoya/hurdaya alınabilir, fakat yalnızca UI açık uyarı gösterip `confirmUnassignAssigned: true` gönderirse. Eski personel bilgisi geçmişe yazılır.
- Transferdeki cihaz bulk status ile değiştirilemez.
- Personel/GLPI sync işlemleri satır başına sorgu yerine `OPENJSON + MERGE` batch kullanır.
- Frontend arka plan delta sync yapar; yaklaşık 10 dakikada bir tam snapshot ile uzlaşır.
- Aktif `src` kodunda tarayıcıya ait `alert/confirm/prompt` kullanılmaz; kullanıcı mesajları portal tabanlı merkezden gösterilir.
- Oturum süresi uyarıları aynı anda birden fazla API isteğinden gelse bile tek mesaj olarak gösterilir.
- Otomatik SQL yedeği üretim veritabanına restore yapmaz; her yedek aynı çalışmada
  `RESTORE VERIFYONLY WITH CHECKSUM` ile doğrulanır. Gerçek restore tatbikatı
  benzersiz geçici veritabanında ayrı scriptle yürütülür ve varsayılan olarak temizlenir.
- PDF/GLPI, AD ve imza kuyrukları varsayılan 30 gün saklanır; temizlik altı saatte
  bir ve tablo başına en fazla 500 satırlık partilerle yapılır.
- PDF kuyruk payload'ı yalnız üretim ve yeniden deneme süresince tam tutulur. Başarıda
  hemen, retry sınırındaki hatada ise son denemeden sonra güvenli özete çevrilir.
- Tek-domain sunumda service worker/manifest dosyaları immutable cache almaz; yalnız
  hash'li build asset'leri uzun süreli cache edilir.
- Genel API trafik sınırı IP başına dakikada 600 istek olarak geniş tutulur; giriş,
  OTP ve agent işlemlerinin daha dar aksiyon sınırları ayrıca uygulanır.

## Commands Already Run

Yerel SQL'e uygulanan son migration'lar:

```powershell
sqlcmd -S "localhost\SQLEXPRESS" -d IstekZimmet -E -b -i backend\sql\008_delta_sync_indexes.sql
sqlcmd -S "localhost\SQLEXPRESS" -d IstekZimmet -E -b -i backend\sql\009_ad_queue_person_status_index.sql
sqlcmd -S "localhost\SQLEXPRESS" -d IstekZimmet -E -b -i backend\sql\010_system_log_chain.sql
sqlcmd -S "localhost\SQLEXPRESS" -d IstekZimmet -E -b -i backend\sql\011_agent_nonce_ledger.sql
sqlcmd -S "localhost\SQLEXPRESS" -d IstekZimmet -E -b -i backend\sql\012_queue_retention.sql
```

Bu turda uygulanan migration ve onarım:

```powershell
sqlcmd -S "localhost\SQLEXPRESS" -d IstekZimmet -E -b -i backend\sql\013_redact_final_operation_payloads.sql
sqlcmd -S "localhost\SQLEXPRESS" -d IstekZimmet -E -b -i backend\sql\014_least_privilege_api_user.sql
sqlcmd -S "localhost\SQLEXPRESS" -d IstekZimmet -E -b -i backend\sql\012_queue_retention.sql
```

Son doğrulama komutları:

```powershell
npm audit --json
npm run lint
npm run build
cd backend
npm audit --json
npm run check
npm test
npm run smoke:api
npm run smoke:cookie
npm run smoke:ui
npm run smoke:ui:auth
npm run smoke:ui:cookie

powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Install-SqlBackupTask.ps1" `
  -SqlCmdPath "C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE" `
  -RunNow
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Test-IstekZimmetRestore.ps1" `
  -SqlCmdPath "C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE"
```

## Tests Passed Or Failed

Passed:
- Frontend ESLint.
- Vite 7.3.6 production build ve PWA üretimi.
- Backend syntax check.
- Frontend ve backend `npm audit`: 0 açık.
- Backend Node testleri: 11/11.
  - Geçerli HMAC.
  - Replay nonce reddi.
  - Değiştirilmiş body reddi.
  - Süresi geçmiş agent isteği reddi.
  - Nonce deposu kullanılamadığında güvenli biçimde 503 ile kapanma.
  - Ham nonce yerine deterministik SHA-256 özeti üretimi.
  - Türkiye telefon normalizasyonu.
  - İki sayfalı zimmet PDF şablonu ve bilimsel seri no düzeltmesi.
  - PDF HTML escaping.
- Güncel backend Node testleri: 33/33.
  - Bilinen aksiyon allowlist'i ve bilinmeyen aksiyon reddi.
  - Prototype-pollution alan reddi ve JSON derinlik sınırı.
  - Kimlik listesi/senkronizasyon şekil doğrulaması ve eski tek-personel uyumluluğu.
  - Kanonik Base64 kabulü, gevşek Base64 reddi ve çözülmüş dosya boyutu sınırı.
  - HttpOnly cookie yazma/temizleme/okuma ile SameSite, Secure ve `__Host-`
    yapılandırma kuralları.
  - OTP test gözlemcisinin normal çalışma sürecinde kapalı kalması.
- `npm run verify:runtime`: başarılı.
  - `zimmet_api` sabit yüksek yetkili rollerde değil.
  - Gerekli tablo/kolon/prosedürler mevcut.
  - Donanım silme, log güncelleme/silme ve nonce tablo okuma izni kapalı.
  - Nonce/kuyruk bakım prosedürleri çalıştırılabilir.
  - 9.111/9.111 log geçerli, 0 bozuk.
- `npm run smoke:api`: 11/11 başarılı.
  - API/SQL health, temel Helmet başlıkları ve `Cache-Control: no-store`.
  - Bozuk JSON, bilinmeyen aksiyon, header/body aksiyon uyuşmazlığı, derin JSON
    ve prototype-pollution alanı doğru biçimde reddedildi.
  - Oturumsuz veri okuma, güvenilmeyen Origin, imzasız export ve bilinmeyen
    endpoint doğru 4xx durumlarıyla reddedildi.
- `npm run smoke:ui`: başarılı.
  - Desktop 1440x900 ve mobil 390x844 login görünümü gerçek Chrome'da açıldı.
  - React/Vite çalışma zamanı hatası, beyaz ekran, yatay taşma veya kırpılmış
    Google giriş düğmesi bulunmadı.
- `npm run smoke:ui:auth`: başarılı.
  - HQ IT görünümünde 2.582 personel ve 1.807 donanım gerçek SQL API'den okundu.
  - Donanım, Personel ve Transfer sekmeleri 1440x900 ile 390x844 görünümde açıldı;
    React/Vite hatası veya yatay taşma bulunmadı.
  - Kısa ömürlü test oturumu işlem sonunda SQL'den başarıyla silindi; iş kaydı
    oluşturulmadı.
- `npm run smoke:cookie`: 5/5 başarılı.
  - Body içindeki geçiş tokenı cookie modunda ve fallback kapalıyken reddedildi.
  - HttpOnly cookie ile gerçek `fetchData` yanıtından 2.582 personel ve 1.807
    donanım okundu.
  - Cross-site cookie isteği HTTP 403 ile engellendi.
  - Logout cookie'yi sonlandırdı, SQL `Sessions` kaydını sildi ve aynı anahtarın
    tekrar kullanımı HTTP 401 ile reddedildi.
- `npm run smoke:ui:cookie`: başarılı.
  - Aynı-domain production build masaüstü 1440x900 ve mobil 390x844 görünümde
    açıldı; iki görünümde de 2.582 personel ve 1.807 donanım gerçek SQL'den okundu.
  - Her iki görünümde sayfa yenileme ve Donanım/Personel/Transfer geçişleri geçti.
  - Gerçek session token localStorage'a girmedi ve HttpOnly cookie
    `document.cookie` üzerinden görünmedi.
  - Çıkış sonrasında localStorage, tarayıcı cookie'si ve SQL session kaydı silindi.
  - Kontrollü süresi dolmuş SQL oturumu HTTP 401 üretti; frontend login ekranına
    döndü, cookie/localStorage temizlendi ve uygulama içi “Oturum sona erdi” mesajı
    gösterildi. Yerel browser dialog sayısı `0`.
  - Görsel hareket paketi sonrasında desktop 1440x900 ve mobil 390x844 tekrar geçti;
    React/Vite hatası veya yatay taşma oluşmadı.
  - Mobil koşuda `prefers-reduced-motion: reduce` emüle edildi ve sekme animasyon
    süresinin erişilebilirlik kuralıyla kapandığı doğrulandı.
- Günlük SQL backup görevi kuruldu ve ilk zamanlanmış çalışma başarılı.
  - Görev: `ISTEK Zimmet SQL Backup`, her gün `02:00`, S4U, gizli pencere.
  - `LastTaskResult=0`; `IstekZimmet_full_20260711_225907.bak` üretildi
    (21.684.224 byte) ve `RESTORE VERIFYONLY WITH CHECKSUM` geçti.
- Gerçek restore tatbikatı başarılı.
  - Geçici DB: `IstekZimmet_RestoreDrill_20260711_225928_c60c7e`.
  - 1.807 donanım, 2.436 personel, 7.902 sistem logu geri okundu.
  - `DBCC CHECKDB` geçti; bozuk log zinciri `0`.
  - Tatbikat DB'si ve fiziksel dosyaları temizlendi; kalan restore-drill DB sayısı `0`.
- Migration `013`: 4/4 nihai PDF payload'ı redakte edildi, hassas alan kalmadı.
- `zimmet_api` ile gerçek session oluşturma/okuma/silme round-trip testi geçti.
- Güvenli işlem kuyruğu sorgusu gerçek SQL'de 5 kayıt için 2.645 byte özet döndürdü;
  imza/OTP/user-agent alanı bulunmadı.
- İki eşzamanlı Puppeteer render smoke testi: iki çıktı da `%PDF`.
- Kontrollü paralel PDF yük testi: 5/5 iş tamamlandı, 0 hata, gözlenen tepe
  eşzamanlılık `2`; zimmet/iade/transfer PDF'leri Drive ve e-posta teslimini geçti.
- Kontrollü toplu iş testi: 12 sentetik cihazın grup güncellemesi, QR sayımı,
  Hurda/Depo geçişi, gerçek SMS OTP, toplu zimmet, gerçek e-posta OTP, toplu iade,
  iki sayfalı PDF, Drive ve e-posta teslimi geçti.
  - Zimmet ve iade PDF işleri ilk denemede tamamlandı; her biri 9 saniye sürdü.
  - 12 cihazın her aşamadaki durum, zimmet sahibi, grup ve Drive bağlantısı doğrulandı.
  - Tamamlanan kuyruk payload'larında imza, OTP ve telefon kalmadı.
  - Sentetik donanım/geçmiş kayıtları ve geçici telefon değişikliği otomatik temizlendi;
    kalan test cihazı `0`, geçici OTP dosyası yok.
- Log zinciri: 6.409/6.409 kayıt geçerli, 0 bozuk.
- Log UPDATE denemesi trigger tarafından reddedildi.
- Zincirli log insert testi transaction içinde doğrulandı ve rollback edildi.
- Gerçek SQL verisindeki zimmetli cihaz bulk status isteği onaysızken doğru şekilde reddedildi; yazma yapılmadı.
- SQL nonce ledger gerçek bağlantı testi: ilk rezervasyon kabul, ikinci rezervasyon ret.
- Ayrı Node süreçlerinde aynı nonce yeniden denendi; ikinci süreçte de reddedildi.
- Sekiz eşzamanlı aynı nonce rezervasyonundan yalnızca biri kabul edildi.
- `zimmet_api` kullanıcısının nonce tablosuna doğrudan erişimi reddedildi.
- `sync-personnel.ps1` PowerShell parser kontrolü.
- `git diff --check` hata vermedi; yalnızca Windows LF/CRLF uyarıları var.

Known gaps:
- Aynı QR'ın 30 saniye içinde tekrar sayılması ve kampüs dışı personele zimmetli
  görünür cihaz senaryosu ayrıca smoke test edilmelidir.
- Uygulama mesaj merkezinin oturumlu ekranlardaki görsel testi son toplu test
  aşamasına bırakıldı; genel build ile oturumsuz desktop/mobil login smoke testi geçti.
- Yeni PDF renderer ile gerçek transfer çıkış/giriş iş kuralları uçtan uca canlı test edilmeli;
  transfer PDF üretimi kontrollü paralel yük testinde geçti.
- HttpOnly cookie altyapısı opsiyonel olarak hazırlandı; geçici yerel backend ve
  gerçek SQL üzerinde cookie/logout/401/cross-site akışı doğrulandı. Aynı-domain
  production build'in desktop/mobil açılışı ve sayfa yenilemesi de gerçek tarayıcıda
  geçti. Canlı ortam ayarları açılana kadar varsayılan token modu çalışmaya devam
  eder; kontrollü süre sonu davranışı geçti, pilotta gerçek Google login ve gerçek
  altı saatlik duvar saati süresi ayrıca gözlemlenmelidir.
- Tam `import:xlsx --reset` işlemi `014` sonrasında `zimmet_api` ile çalışmaz; import
  ayrı yönetici bağlantısıyla yapılmalı veya en az yetki migration'ından önce bitirilmelidir.
- Yerel backend `node --watch src/server.js` ile çalışıyor; güncel request validation
  canlı API smoke testinde doğrulandı. Planlı görev/production süreci kullanılırken
  yeni deploy sonrasında kontrollü yeniden başlatma yine gereklidir.

## Remaining TODOs

1. Transfer çıkış/giriş iş kurallarını yalnız yetkili test kampüsleriyle uçtan uca yeniden test et.
2. Aynı QR'ın 30 saniyelik tekrar sayım tekilleştirmesini ve kampüs dışı personele
   zimmetli görünür cihaz senaryosunu kontrollü yazma testiyle doğrula.
3. Canlı tek-domain pilotunda HttpOnly cookie ortam ayarlarını açıp gerçek Google
   login ve gerçek altı saatlik duvar saati süresini gözlemle; kontrollü süre sonu,
   sayfa yenileme, logout/401 ve cross-site koruması izole smoke testlerinde tamamlandı.
4. Oturumlu yazma akışlarının tarayıcı kapsamını son toplu testte genişlet;
   oturumsuz login ile salt-okunur Donanım/Personel/Transfer smoke testleri tamamlandı.
5. `C:\ZimmetBackup` yedeklerini BitLocker korumalı ikinci disk veya erişimi
   sınırlandırılmış kurum depolamasına kopyalama politikasını devreye al; yerel
   görev ve gerçek restore tatbikatı tamamlandı.
6. Değişiklikleri mantıksal commitlere böl; çalışma ağacındaki eski ve yeni değişiklikleri körlemesine tek commit yapma.
7. Her canlı güncelleme öncesi `npm run verify:runtime`, `npm run smoke:api`,
   `npm run smoke:cookie`, `npm run smoke:ui`, `npm run smoke:ui:auth` ve
   `npm run smoke:ui:cookie` çalıştır. Bu paket 12.07.2026 tarihinde transfer
   zamanı ve GLPI ekranı düzeltmelerinden sonra eksiksiz geçti.

## 12.07.2026 Transfer ve GLPI Düzeltmeleri

- Bekleyen transfer kartı artık lazy-load geçmişine bağımlı değil; `fetchData`
  yanıtındaki son donanım hareketi, yapan kişi ve tarih alanlarını kullanıyor.
- Transfer tarihi `Europe/Istanbul` saat diliminde okunur biçimde gösteriliyor.
- `Karşı Taraf Onayı Bekliyor` metni `Alıcı Onayı Bekleniyor` olarak değiştirildi.
- `GLPI'dan Donanım Ekle` açılışında eski arama/filtreler temizleniyor, tek yükleme
  isteği çalışıyor ve masaüstü/mobil boş durumları açıklayıcı metin gösteriyor.
- Veri önbelleği `v3` yapıldı; eski donanım nesneleri yeni tarih alanlarını gizlemiyor.
- Cookie UI smoke testi artık GLPI ekleme ekranını da açıp listenin render edildiğini
  doğruluyor. Testte 1.930 eksik GLPI cihazı döndü.
- Doğrulamalar: frontend lint/build, 32 backend testi, runtime doğrulaması,
  API 11/11, cookie 5/5, desktop/mobile UI, token auth UI ve HttpOnly cookie UI.

## Exact Next Command To Continue

Canlı/pilot güncelleme öncesi teknik doğrulama:

```powershell
cd C:\Users\comert.yanar\Documents\Codex\2026-04-27\github-plugin-github-openai-curated-zimmet\backend
npm run verify:runtime
npm run smoke:api
npm run smoke:cookie
npm run smoke:ui
npm run smoke:ui:auth
npm run smoke:ui:cookie
```

Yerel `8787` portunda çalışan `node --watch src/server.js` süreci varken ikinci kez
`npm run dev` çalıştırma; bu `EADDRINUSE` hatası üretir. İzole HttpOnly cookie API
ve aynı-domain tarayıcı testleri tamamlandı. Bir sonraki adım canlı tek-domain
Google login pilotu veya kullanıcının ertelediği gerçek toplu zimmet/transfer yazma
akışı testleridir.
