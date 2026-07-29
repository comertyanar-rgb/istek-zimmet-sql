# AD Password Agent

Bu klasordeki ajan, SQL API'deki `ADPasswordQueue` kuyruğunu okur ve sifre sifirlama
islemini kurum icindeki Windows/AD makinesinde yapar.

## Gerekenler

- PowerShell 7 veya uzeri
- Active Directory PowerShell modulu
- `C:\ZimmetAD\ad-reset-private.pem` private key dosyasi
- Backend `.env` icindeki `AD_AGENT_SECRET` ile ayni secret
- API calisir durumda olmali: `http://localhost:8787/api/action`

## Servis hesabi

Uretimde gorevi oturum acmis yonetici hesabi veya `SYSTEM` ile calistirmayin.
AD'de yalnizca hedef kullanici OU'larinda su yetkilere sahip ayri bir servis
hesabi kullanin:

- Kullanici nesnelerini okuma
- Parola sifirlama
- Sonraki oturumda parola degistirme zorunlulugunu ayarlama

Hesaba Domain Admin vermeyin. RDP/etkilesimli oturum acma izni vermeyin; yalnizca
Windows Server uzerinde "Log on as a batch job" hakki verin.

## Ortam Degiskenleri

Zamanlanmis gorev ayri bir servis hesabi ile calisacagi icin degerleri `Machine`
kapsaminda girin:

```powershell
[Environment]::SetEnvironmentVariable("ZIMMET_API_URL", "http://127.0.0.1:8787/api/action", "Machine")
[Environment]::SetEnvironmentVariable("AD_AGENT_SECRET", "BURAYA_BACKEND_AD_AGENT_SECRET", "Machine")
[Environment]::SetEnvironmentVariable("AD_RESET_PRIVATE_KEY_PATH", "C:\ZimmetAD\ad-reset-private.pem", "Machine")
```

Bildirim kullanilacaksa ayni ajan makinesinde bunlar da tanimlanabilir:

Bu degerleri de `Machine` kapsaminda tanimlayin:

- `ZIMMET_SMTP_SERVER`
- `ZIMMET_SMTP_PORT`
- `ZIMMET_SMTP_USER`
- `ZIMMET_SMTP_PASSWORD`
- `ZIMMET_SMTP_USE_SSL`
- `ZIMMET_NOTIFY_EMAIL_FROM`
- `MOBILDEV_API_KEY`
- `MOBILDEV_API_SECRET`
- `MOBILDEV_ORIGINATOR`

## Manuel Test

`WhatIfOnly` bekleyen isi kiralar. Gercek kuyrukta bekleyen kayit varken
kullanmayin. Once kuyrugun bos oldugunu kontrol edin, ardindan akis testi icin:

```powershell
pwsh -ExecutionPolicy Bypass -File .\ad\windows\Run-ADPasswordAgent.ps1 -WhatIfOnly -Limit 1
```

Gercek calistirma:

```powershell
pwsh -ExecutionPolicy Bypass -File .\ad\windows\Run-ADPasswordAgent.ps1 -Limit 5
```

## Gorev Zamanlayici

Onerilen sessiz kurulum (yonetici PowerShell penceresinde):

```powershell
powershell.exe -ExecutionPolicy Bypass `
  -File ".\ad\windows\Install-ADPasswordAgentTask.ps1" `
  -IntervalMinutes 1 `
  -ScriptPath "E:\IstekZimmet\App\ad\windows\Run-ADPasswordAgent.ps1" `
  -WorkingDirectory "E:\IstekZimmet\App" `
  -RunnerPath "E:\IstekZimmet\Run-ADPasswordAgentTask.ps1" `
  -LogPath "E:\IstekZimmet\Logs\ad-agent.log" `
  -RunAsUser "ISTEK\svc_zimmet_ad" `
  -AtStartup `
  -RunNow
```

Kurucu servis hesabi parolasini guvenli kimlik bilgisi penceresinde sorar; parola
komut satirina veya loga yazilmaz. Gorev arka planda calisirken PowerShell
penceresi acmaz. Bos kuyrukta log yazmaz ve log dosyasini 5 MB'da dondurur.

Test ederken pencereyi gormek istersen:

```powershell
powershell.exe -ExecutionPolicy Bypass `
  -File ".\ad\windows\Install-ADPasswordAgentTask.ps1" `
  -IntervalMinutes 1 `
  -RunAsUser "ISTEK\svc_zimmet_ad" `
  -Visible
```

Private key dosyasini repoya koymayin. `.gitignore` PEM/key dosyalarini bilerek disarida birakir.
