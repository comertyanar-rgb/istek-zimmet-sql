# Gmail Imza Otomasyonu Konusma Ozeti

## Hedef

Kurumda Google Workspace / Gmail kullaniliyor. Personel imzalari kampuse gore farkli arka planlarla hazirlaniyor. Her imzada su bilgiler yer aliyor:

- Ad Soyad
- Turkce unvan
- Ingilizce unvan
- E-posta adresi
- Kampus adresi / telefon bilgileri

Drive paylasimi disariya kapali oldugu icin imza gorselleri kurum sitesine yukleniyor. Gmail imzasi da GAM ile HTML olarak kullanicilara basiliyor.

## Mevcut Yapi

Google Sheet uzerinde su mantik zaten kuruluydu:

- Kampus seciliyor.
- Mail adresi ve isim yaziliyor.
- Unvan seciliyor.
- Ingilizce unvan `ünvanlar` sayfasindan eslestiriliyor.
- Kampus adresi ve kullanilacak kampus imaj yolu `kampüsler` sayfasindan geliyor.
- Random karakterlerden olusan `url/id` alani kullaniliyor.
- Resim linki su mantikla uretiliyor:

```text
https://istek.site/imza/{id}/{id}.jpg
```

- GAM komutu su mantikla uretiliyor:

```text
gam user {mail} signature file signature/{id}.html html
```

Mevcut manuel surec:

1. Sheet'ten Photoshop icin TXT uretiliyordu.
2. Photoshop'ta template acilip `Image > Variables > Data Sets` ile TXT seciliyordu.
3. PSD/JPG dosyalari uretiliyordu.
4. HTML dosyalari uretiliyordu.
5. FileZilla ile siteye manuel upload yapiliyordu.
6. GAM komutu CMD'den calistiriliyordu.

## Gotham / Kurumsal Font Karari

Google Slides'a Gotham / Gotham Bold gibi ozel font dosyalari yuklenemeyecegi icin Google Slides uretim motoru olarak uygun degil.

Dogru karar:

```text
Google Sheet = veri ve onay paneli
Photoshop = kurumsal fontlarla JPG uretim motoru
Windows Task Scheduler = yerel otomasyon
WinSCP = otomatik upload
GAM = Gmail imzasini basma
```

Bu sayede Gotham fontu Photoshop PSD icindeki text layer'larda korunuyor.

## Yeni Sheet Mantigi

Sheet'e su kolonlar eklenecek:

```text
İşleme Al
Durum
Son İşlem
```

Yeni akis:

```text
IK / IT unvani secer
İşleme Al checkbox'ini isaretler
Export Tools > İşleme alınan imzaları üret
Script sadece isaretli satirlari isler
TXT + HTML + GAM .cmd dosyalarini Drive'a uretir
Drive Sync bu dosyalari C:\GAMWork altina indirir
Windows otomasyonu Photoshop + upload + GAM islemini yapar
```

Apps Script icin hazir dosya:

```text
C:\Users\comert.yanar\Documents\Codex\2026-04-30\kurumumuzda-gmail-kullan-yoruz-ve-personellerin\apps-script-imza-otomasyon.gs
```

Scriptte ozellikle su kisimlar kendi Sheet'e gore ayarlanacak:

```js
mainSheetName: 'Ana'
photoshopDatasetFolderId
htmlFolderId
gamCommandFolderId
```

## Windows Klasor Yapisi

Otomasyon icin hedef klasor:

```text
C:\GAMWork
```

Klasorler:

```text
C:\GAMWork\datasets
C:\GAMWork\signature
C:\GAMWork\commands
C:\GAMWork\jpg
C:\GAMWork\scripts
C:\GAMWork\template
C:\GAMWork\logs
C:\GAMWork\processed
C:\GAMWork\job
```

Drive Sync eslesmesi:

```text
Photoshop TXT dataset -> C:\GAMWork\datasets
HTML dosyalari        -> C:\GAMWork\signature
GAM .cmd dosyalari    -> C:\GAMWork\commands
```

PSD template:

```text
C:\GAMWork\template\imza-template.psd
```

Photoshop script:

```text
C:\GAMWork\scripts\photoshop-generate-signatures.jsx
```

Pipeline script:

```text
C:\GAMWork\scripts\Run-ImzaPipeline.ps1
```

WinSCP oturum dosyasi:

```text
C:\GAMWork\scripts\winscp-open.txt
```

Icerigi ornek:

```text
open "ftp://KULLANICI:SIFRE@ftp.istek.site/"
```

FTPS kullaniliyorsa:

```text
open "ftpes://KULLANICI:SIFRE@ftp.istek.site/"
```

## Photoshop 2026

Photoshop 2026 sorun cikarmadi. Varsayilan yol su sekilde ayarlandi:

```text
C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe
```

Photoshop kapaliysa pipeline aciyor. Aciksa ayni Photoshop icinde script calisiyor. Is bitince PSD kapaniyor, Photoshop uygulamasi acik kalabilir.

Task Scheduler icin onemli:

```text
Run only when user is logged on
```

Cunku Photoshop GUI uygulamasi oldugu icin kullanici oturumu acik olmali.

## Turkce Karakter Sorunu

Ilk Photoshop testinde Turkce karakterler bozuk cikti:

```text
Ahşap -> AhÅŸap
Acıbadem -> AcÄ±badem
Kadıköy -> KadÄ±kÃ¶y
```

Sebep:

```text
UTF-8 TXT dosyasini Photoshop Auto/Latin encoding gibi okudu.
```

Cozum:

`photoshop-generate-signatures.jsx` icinde data set import encoding `Auto` yerine `UTF-8` yapildi:

```js
stringIDToTypeID("dataSetEncodingUTF8")
```

Sonraki testte JPG dogru uretildi.

## WinSCP / FileZilla Karari

Normal FileZilla Client manuel upload icin uygun ama Task Scheduler ile sessiz, loglu, hata kodu donduren otomasyon icin uygun degil.

WinSCP kullanildi. Turkiye'den siteye erisim sorunu olursa guvenilir alternatif kaynaklardan kurulabilir:

- winget
- SourceForge resmi WinSCP projesi
- Microsoft Store surumu

Script `WinSCP.com` icin iki standart yolu kontrol edecek sekilde ayarlandi:

```text
C:\Program Files (x86)\WinSCP\WinSCP.com
C:\Program Files\WinSCP\WinSCP.com
```

Farkli kurulum varsa parametreyle verilebilir:

```powershell
-WinScpCom "D:\Tools\WinSCP\WinSCP.com"
```

## Upload Testi

Ilk upload testi basarili gorundu ama URL 404 verdi:

```text
https://istek.site/imza/GDVDMF0JPT/GDVDMF0JPT.jpg
```

Sebep:

```text
Dosya FTP kokunde /imza altina gidiyordu, web kokunde degildi.
```

Dogru remote path FileZilla'da kontrol edildi ve su bulundu:

```text
/public_html/imza
```

Dogru upload komutu:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\GAMWork\scripts\Run-ImzaPipeline.ps1" -SkipPhotoshop -SkipGam -RemoteBasePath "/public_html/imza"
```

Bu komuttan sonra URL calisti.

## GAM Testi

GAM testi de basarili calisti.

Test komutu:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\GAMWork\scripts\Run-ImzaPipeline.ps1" -SkipPhotoshop -SkipUpload -RemoteBasePath "/public_html/imza"
```

## Son Dogru Pipeline Komutu

Tam otomasyon icin kullanilacak komut:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\GAMWork\scripts\Run-ImzaPipeline.ps1" -RemoteBasePath "/public_html/imza"
```

Bu komut:

1. Yeni dataset dosyasini bulur.
2. Photoshop'u calistirir.
3. JPG dosyalarini uretir.
4. WinSCP ile siteye yukler.
5. GAM komut dosyasini calistirir.
6. Islenen dataset ve GAM dosyasini `processed` klasorune tasir.

Test modunda `-SkipPhotoshop`, `-SkipUpload` veya `-SkipGam` kullanilirsa input dosyalari yerinde kalir.

## Task Scheduler Ayarlari

Trigger:

```text
Zamanlamayla
Bir kez baslat
Gorevi su siklikta yinele: 10 dakika
Sure: Suresiz
Etkin
```

Action / Eylem:

Program:

```text
powershell.exe
```

Arguments:

```text
-ExecutionPolicy Bypass -File "C:\GAMWork\scripts\Run-ImzaPipeline.ps1" -RemoteBasePath "/public_html/imza"
```

Start in:

```text
C:\GAMWork
```

General sekmesi onerisi:

```text
Yalnizca kullanici oturum actiginda calistir
En yuksek ayricaliklarla calistir
```

Settings sekmesi:

```text
Gorev zaten calisiyorsa: Yeni bir ornek baslatma
```

Bu onemli; Photoshop uzun surerse ayni anda ikinci pipeline baslamasin.

## Son Durum

Calisan kisimlar:

- Photoshop 2026 ile JPG uretimi basarili.
- Turkce karakter sorunu cozuldu.
- WinSCP upload basarili.
- Dogru remote path bulundu: `/public_html/imza`.
- URL uzerinden JPG aciliyor.
- GAM testi basarili.

Kalan is:

- Task Scheduler son komutla aktif hale getirilecek.
- Canli kullanimda once az sayida test kullanicisi ile denenmeli.
- Eski test dataset/GAM dosyalari gerekirse `C:\GAMWork\datasets` ve `C:\GAMWork\commands` klasorlerinden ayrilmali veya temizlenmeli.
