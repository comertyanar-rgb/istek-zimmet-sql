# Windows imza ajani

Bu ajan SQL'deki `SignatureJobs` kuyrugundan is alir, imza JPG'sini gorunmez
Chrome/Edge ile uretir, sunucuya yukler, GAM komutunu calistirir ve sonucu SQL
API'ye bildirir. Varsayilan akista Photoshop gerekmez.

## Gereksinimler

- Node.js 20 veya daha yeni
- Google Chrome ya da Microsoft Edge
- Kurumun lisansli Gotham Book, Gotham Medium ve Gotham Bold font dosyalari
- WinSCP (FTP/SFTP yuklemesi icin)
- GAMADV-XTD3
- PowerShell 7 onerilir; Windows PowerShell 5.1 de desteklenir
- `backend` klasorunde `npm ci` calistirilmis olmalidir

Photoshop sadece eski akisa donmek icin istege bagli yedek motordur.

Gotham fontlarini sunucuda asagidaki adlarla `C:\GAMWork\fonts` klasorune
kopyalayin. Headless uretici bu fontlari JPG'nin HTML kaynagina dogrudan gomerek
Photoshop sablonuyla ayni tipografiyi korur:

```text
Gotham Book.otf
Gotham Medium.otf
Gotham Bold.otf
```

Fontlar bulunamazsa ajan farkli bir sistem fontuna sessizce gecmez; hatali gorunum
uretilmesini engellemek icin isi acik bir hata ile durdurur. Font lisansinin
sunucuda kullanima izin verdigini kurum lisansinizdan dogrulayin.

## Klasorler

Ajan asagidaki klasorleri gerektiginde kendisi olusturur:

```text
C:\GAMWork\datasets
C:\GAMWork\signature
C:\GAMWork\commands
C:\GAMWork\jpg
C:\GAMWork\campus
C:\GAMWork\fonts
C:\GAMWork\scripts
C:\GAMWork\logs
C:\GAMWork\processed
C:\GAMWork\job
```

Kampus alt bant PNG'lerini `C:\GAMWork\campus` altina koyun. Dosya adlari
Kampus tablosundaki `CampusImage` degerleriyle ayni olmalidir. Ornek:

```text
AB.png
AN.png
AO.png
BE.png
BK.png
GM.png
IO.png
KA.png
KL.png
KM.png
SS.png
UB.png
```

SQL'de eski bilgisayara ait tam bir `CampusImage` yolu bulunsa bile ajan once dosya
adini alir ve `C:\GAMWork\campus` altinda arar. Boylece sunucuya geciste eski yerel
yollari tek tek degistirmek gerekmez.

## Sablonlar

Sekiz sablon anahtari desteklenir:

```text
1    1-w
2    2-w
3    3-w
4    4-w
```

- `1`-`4`: unvan uzunluguna gore kademeli font boyutlari
- `-w`: ayni unvan kademesi, uzun ad/soyad icin daha kucuk ad fontu

Sistem ad uzunlugunu otomatik olcer. Ad 25 karakteri veya agirlikli genisligi 22
birimi gecerse secilen sablona otomatik olarak `-w` eklenir. Yoneticiler Sistem >
Imza Unvanlari ekraninda bir unvan icin `1-w` ... `4-w` anahtarini elle de
zorlayabilir.

Eski anahtarlar geriye donuk desteklenir:

```text
normal  -> 1
compact -> 2
small   -> 3
tiny    -> 4
```

Headless motorda PSD dosyasi kullanilmaz. Boyut ve font farklari kod tarafindan
uygulanir. Photoshop yedegi kullanilacaksa `imza-template-1.psd` ...
`imza-template-4-w.psd` dosyalari `C:\GAMWork\template` altinda tutulabilir.

## Ortam degiskenleri

Ayni ajan anahtarini backend `.env` dosyasina ve ajani calistiran Windows hesabina
girin:

```text
Backend .env:
SIGNATURE_AGENT_SECRET=uzun-rastgele-deger

Windows ortam degiskeni:
SIGNATURE_AGENT_SECRET=ayni-uzun-rastgele-deger
```

Istege bagli ayarlar:

```text
SIGNATURE_API_URL=http://127.0.0.1:8787/api/action
SIGNATURE_CALLBACK_URL=http://127.0.0.1:8787/api/action
SIGNATURE_RENDER_ENGINE=Headless
SIGNATURE_RENDERER_PATH=E:\IstekZimmet\App\backend\scripts\render-signatures.js
SIGNATURE_CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
SIGNATURE_CAMPUS_DIR=C:\GAMWork\campus
SIGNATURE_FONT_DIR=C:\GAMWork\fonts
```

`SIGNATURE_AGENT_SECRET` yoksa ajan SQL kuyrugundan is alamaz. Gecis kolayligi
icin `ZIMMET_SIGNATURE_AGENT_SECRET`, `AD_AGENT_SECRET` ve `ZIMMET_SYNC_SECRET`
sirayla yedek olarak okunur; canli ortamda ayri `SIGNATURE_AGENT_SECRET`
kullanilmasi onerilir.

## FTP/SFTP ayari

`C:\GAMWork\scripts\winscp-open.txt` icine baglanti satirini yazin:

```text
open "sftp://USERNAME:PASSWORD@example.com/" -hostkey="ssh-ed25519 255 xx:xx:xx"
```

FTP kullaniliyorsa:

```text
open "ftp://USERNAME:PASSWORD@example.com/"
```

Uzak klasor varsayilan olarak `/public_html/imza` dizinidir. Farkliysa ajan
komutuna `-RemoteBasePath` parametresi ekleyin.

## Ilk test

Ilk denemede SQL kuyrugundan is almayin. `SkipUpload`, `SkipGam` ve
`SkipSignatureCallback` ile yapilan bir SQL kuyruk denemesi isi kiralayip
`ISLENIYOR` durumunda birakabilir. Once kuyruktan bagimsiz tek bir hazir dataset'i
dogrudan render edin:

```powershell
node .\backend\scripts\render-signatures.js `
  --dataset "C:\GAMWork\datasets\Photoshop_Dataset_TEST_tpl1-w.txt" `
  --output-dir "C:\GAMWork\jpg" `
  --template-key "1-w" `
  --chrome-path "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --campus-dir "C:\GAMWork\campus" `
  --font-dir "C:\GAMWork\fonts"
```

JPG dosyasi `C:\GAMWork\jpg` altinda 1072x287 piksel olarak olusmalidir. Bu test
SQL, FTP/SFTP, GAM ve personel imza kaydini degistirmez.

Bu test basarili olduktan sonra siteden yalniz bir test personeli icin imza isi
olusturun ve tam akisi elle bir kez calistirin:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass `
  -File ".\imza\windows\Run-ImzaPipeline.ps1" `
  -RenderEngine Headless `
  -HeadlessRendererPath ".\backend\scripts\render-signatures.js" `
  -CampusImageDir "C:\GAMWork\campus" `
  -DisablePhotoshopFallback
```

## Gorev Zamanlayici

Yonetici PowerShell 7 ile depo kokunde calistirin:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass `
  -File ".\imza\windows\Install-ImzaAgentTask.ps1" `
  -IntervalMinutes 2 `
  -RenderEngine Headless `
  -NodeExe "C:\Program Files\nodejs\node.exe" `
  -HeadlessRendererPath "E:\IstekZimmet\App\backend\scripts\render-signatures.js" `
  -ChromePath "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -CampusImageDir "C:\GAMWork\campus" `
  -DisablePhotoshopFallback
```

Kurulum betigi `C:\GAMWork\scripts\Run-ImzaAgentHidden.vbs` dosyasini otomatik
olusturur. Gorev `wscript.exe` uzerinden calisir; PowerShell veya Chrome penceresi
gostermez. Ayni gorev zaten varsa guvenli bicimde guncellenir.

Kontrol:

```powershell
Get-ScheduledTask -TaskName "ISTEK Zimmet Imza Agent" |
  Select-Object TaskName, State

Start-ScheduledTask -TaskName "ISTEK Zimmet Imza Agent"
Start-Sleep -Seconds 10
Get-ScheduledTaskInfo -TaskName "ISTEK Zimmet Imza Agent" |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
```

`LastTaskResult` degeri `0` olmali. Ajan loglari `C:\GAMWork\logs` altindadir.

## Photoshop yedegi

Headless uretim basarisiz oldugunda Photoshop'a otomatik gecmek isteniyorsa
`-DisablePhotoshopFallback` parametresini kaldirin ve Photoshop yolunu verin:

```powershell
-PhotoshopExe "C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe"
```

Sunucuda Photoshop bulunmayacaksa `-DisablePhotoshopFallback` mutlaka kullanin;
boylece bir hata sessizce baska bir motora gecmek yerine acik olarak loglanir.
