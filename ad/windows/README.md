# AD Password Agent

Bu klasordeki ajan, SQL API'deki `ADPasswordQueue` kuyruğunu okur ve sifre sifirlama
islemini kurum icindeki Windows/AD makinesinde yapar.

## Gerekenler

- PowerShell 7 veya uzeri
- Active Directory PowerShell modulu
- `C:\ZimmetAD\ad-reset-private.pem` private key dosyasi
- Backend `.env` icindeki `AD_AGENT_SECRET` ile ayni secret
- API calisir durumda olmali: `http://localhost:8787/api/action`

## Ortam Degiskenleri

Makine veya kullanici ortam degiskeni olarak girilebilir:

```powershell
setx ZIMMET_API_URL "http://localhost:8787/api/action"
setx AD_AGENT_SECRET "BURAYA_BACKEND_AD_AGENT_SECRET"
setx AD_RESET_PRIVATE_KEY_PATH "C:\ZimmetAD\ad-reset-private.pem"
```

Bildirim kullanilacaksa ayni ajan makinesinde bunlar da tanimlanabilir:

```powershell
setx ZIMMET_SMTP_SERVER "smtp.gmail.com"
setx ZIMMET_SMTP_PORT "587"
setx ZIMMET_SMTP_USER "bildirim@istek.k12.tr"
setx ZIMMET_SMTP_PASSWORD "GOOGLE_APP_PASSWORD"
setx ZIMMET_SMTP_USE_SSL "true"
setx ZIMMET_NOTIFY_EMAIL_FROM "bildirim@istek.k12.tr"

setx MOBILDEV_API_KEY "..."
setx MOBILDEV_API_SECRET "..."
setx MOBILDEV_ORIGINATOR "ISTEKOKUL"
```

## Manuel Test

AD'ye yazmadan sadece akis testi:

```powershell
pwsh -ExecutionPolicy Bypass -File .\ad\windows\Run-ADPasswordAgent.ps1 -WhatIfOnly -Limit 1
```

Gercek calistirma:

```powershell
pwsh -ExecutionPolicy Bypass -File .\ad\windows\Run-ADPasswordAgent.ps1 -Limit 5
```

## Gorev Zamanlayici

Program:

```text
C:\Program Files\PowerShell\7\pwsh.exe
```

Arguman:

```text
-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\ZimmetAD\Run-ADPasswordAgent.ps1" -Limit 5
```

Tetikleyici icin pratik kurulum:

- Baslangicta bir kez calissin.
- "Gorevi su siklikta yenile" ayari 1 dakika olsun.
- "Su sureyle" ayari "Suresiz" olsun.
- "Gorev zaten calisiyorsa yeni ornek baslatma" secili olsun.

Private key dosyasini repoya koymayin. `.gitignore` PEM/key dosyalarini bilerek disarida birakir.
