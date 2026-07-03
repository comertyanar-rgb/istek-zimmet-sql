# Windows imza pipeline kurulumu

Bu klasordeki dosyalar Google Sheet'in Drive'a urettigi dosyalari yerelde isler.

## Klasor yapisi

`C:\GAMWork` altinda su klasorler kullanilir:

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

Google Drive for Desktop tarafinda:

```text
Photoshop dataset klasoru -> C:\GAMWork\datasets
HTML klasoru              -> C:\GAMWork\signature
GAM command klasoru       -> C:\GAMWork\commands
```

## Dosyalari yerlestir

```text
Run-ImzaPipeline.ps1              -> C:\GAMWork\scripts\Run-ImzaPipeline.ps1
photoshop-generate-signatures.jsx -> C:\GAMWork\scripts\photoshop-generate-signatures.jsx
winscp-open.example.txt           -> C:\GAMWork\scripts\winscp-open.txt
```

`winscp-open.txt` icindeki FTP bilgisini doldur:

```text
open "ftp://USERNAME:PASSWORD@ftp.example.com/"
```

Normal FileZilla Client otomatik upload icin uygun degildir. Gorev Zamanlayici'da
sessiz calisip klasor olusturma, dosya yukleme, hata kodu dondurme ve log tutma
gibi islemler icin WinSCP veya FileZilla Pro CLI gerekir.

FileZilla Pro CLI kullaniyorsan pipeline'in upload kismi ayrica fzcli komutlarina
gore uyarlanmalidir. Standart FileZilla Client kullaniliyorsa bu scriptteki WinSCP
bolumunu korumak en stabil yoldur.

PSD template dosyalarini da su yola koy:

```text
C:\GAMWork\template\imza-template-1.psd
C:\GAMWork\template\imza-template-2.psd
C:\GAMWork\template\imza-template-3.psd
C:\GAMWork\template\imza-template-4.psd
```

`Unvanlar` sayfasinda 3. kolona `1`, `2`, `3` veya `4` sablon numarasi
yazilirsa SQL kuyrugu ve Windows ajani ayni numarali PSD'yi kullanir. Bu
kolon bos kalirsa sistem unvan uzunluguna gore otomatik olarak 1-4 arasinda
bir sablon secer.

Eski `normal`, `compact`, `small`, `tiny` varyantlari da geriye donuk uyumluluk
icin sirasiyla `1`, `2`, `3`, `4` olarak yorumlanir.

PSD icindeki variable isimleri TXT basliklariyla eslesmeli:

```text
ad
unvan
ing
email
adres
CampusImage
```

Ilk kolon olan `filename`, dosya adi ve data set adi olarak kullanilir.

## Ilk test

Once upload ve GAM'i kapatip sadece Photoshop'u test et:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\GAMWork\scripts\Run-ImzaPipeline.ps1" -SkipUpload -SkipGam
```

Photoshop farkli bir yoldaysa parametreyle ver:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\GAMWork\scripts\Run-ImzaPipeline.ps1" -PhotoshopExe "C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe" -SkipUpload -SkipGam
```

JPG dosyalari burada olusmali:

```text
C:\GAMWork\jpg
```

Sonra sadece upload'u test et:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\GAMWork\scripts\Run-ImzaPipeline.ps1" -SkipPhotoshop -SkipGam
```

Son olarak komple calistir:

```powershell
powershell.exe -ExecutionPolicy Bypass -File "C:\GAMWork\scripts\Run-ImzaPipeline.ps1"
```

SQL gecisinden sonra ajan artik `SignatureJobs` kuyrugundan is cekebilir. Klasorde
hazir `Photoshop_Dataset_*.txt` dosyasi varsa once onu isler; yoksa SQL API'ye
`fetchSignatureJobs` istegi atip dataset, HTML ve GAM dosyalarini yerelde kendisi
olusturur.

GAM basimi bittikten sonra personelin `Imza Durumu` bilgisinin otomatik
`Basildi` olmasi icin ayni gizli degeri iki yere gir:

```text
SQL API backend .env:
SIGNATURE_AGENT_SECRET = uzun-rastgele-bir-deger

Windows ortam degiskeni:
SIGNATURE_AGENT_SECRET = ayni-uzun-rastgele-deger
```

Windows ortam degiskeni yoksa ajan yedek olarak `ZIMMET_SIGNATURE_AGENT_SECRET`,
sonra gecis kolayligi icin `AD_AGENT_SECRET`, en son `ZIMMET_SYNC_SECRET`
degerini kullanmayi dener. Secret bos kalirsa SQL kuyrugundan is cekmez; klasorde
hazir dosya varsa imza basilir ama durum callback'i atlanir.

Varsayilan SQL API adresi:

```text
http://localhost:8787/api/action
```

Farkli bir adres kullanacaksan Windows ortam degiskeni olarak gir:

```text
SIGNATURE_API_URL = http://sunucu-adresi:8787/api/action
```

Callback adresi ayri olacaksa:

```text
SIGNATURE_CALLBACK_URL = http://sunucu-adresi:8787/api/action
```

## Gorev Zamanlayici

Windows Task Scheduler'da yeni gorev olustur:

```text
Program/script:
powershell.exe

Add arguments:
-ExecutionPolicy Bypass -File "C:\GAMWork\scripts\Run-ImzaPipeline.ps1"

Start in:
C:\GAMWork
```

Tetikleyici olarak her 5 veya 10 dakikada bir calistirabilirsin.

## Not

WinSCP remote yolu `Run-ImzaPipeline.ps1` icindeki `RemoteBasePath` parametresiyle belirlenir.
Sitedeki gercek yol `/public_html/imza` veya `/httpdocs/imza` ise gorev argumanina sunu ekle:

```powershell
-RemoteBasePath "/public_html/imza"
```
