# Personnel Sync Agent

Bu ajan Google Sheet `Kullanıcılar` sayfasını SQL Server'daki `Personnel`
tablosuna senkronlar.

## Mimari

SQL API disariya acilmadigi icin Apps Script `http://sunucu:8787` veya
`localhost` adresine erisemez. Bu nedenle Apps Script sadece `Kullanıcılar`
sayfasini JSON olarak disari verir; kurum icindeki Windows ajan bu JSON'u ceker
ve lokal SQL API'ye yazar.

```text
Form / Google Admin Script
  -> Kullanıcılar Sheet
  -> Apps Script exportPersonnelForSync
  -> sync-personnel.ps1
  -> http://localhost:8787/api/action
  -> SQL Personnel
```

## Gerekenler

- SQL API calisiyor olmali: `http://localhost:8787/api/action`
- Apps Script Web App yeni surum deploy edilmeli.
- Apps Script tarafinda `exportPersonnelForSync` aksiyonu olmali.
- Backend `.env` ve Apps Script Properties ayni `PERSONNEL_SYNC_SECRET` degerini kullanmali.

## Ortam Degiskenleri

PowerShell'de bir kez gir:

```powershell
[Environment]::SetEnvironmentVariable("PERSONNEL_EXPORT_URL", "https://script.google.com/macros/s/.../exec", "User")
[Environment]::SetEnvironmentVariable("PERSONNEL_SYNC_SECRET", "BACKEND_ILE_AYNI_SECRET", "User")
[Environment]::SetEnvironmentVariable("ZIMMET_API_URL", "http://localhost:8787/api/action", "User")
```

Yeni PowerShell ac.

## Manuel Test

Once sadece Google tarafindan veri cekiliyor mu bak:

```powershell
cd C:\Users\comert.yanar\Documents\Codex\2026-04-27\github-plugin-github-openai-curated-zimmet
.\sync-personnel.ps1 -DryRun
```

SQL'e yaz:

```powershell
.\sync-personnel.ps1
```

Loglu calistirma:

```powershell
.\sync-personnel.ps1 -LogPath "C:\ZimmetPersonnel\personnel-sync.log" -LogSuccess
```

## Gorev Zamanlayici

Tek komutla 5 dakikada bir calisan gorev kur:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\personnel\windows\Install-PersonnelSyncTask.ps1" -IntervalMinutes 5
```

Varsayilan gorev:

```text
ISTEK Zimmet Personnel Sync
```

Varsayilan log:

```text
C:\ZimmetPersonnel\personnel-sync.log
```

Gorev sadece hata, yeni eklenen, atlanan veya uyarili durumlari loglar. Her
basarili calismayi loglamak istersen gorev argumanina `-LogSuccess` ekleyebilirsin.

## Notlar

- Bu sync sifre, TC kimlik veya gecici parola tasimaz.
- Sheet'te bos gelen telefon, imza linki veya fotograf alanlari SQL'deki dolu
  degeri silmez.
- Google Admin scripti once Sheet'i gunceller; bu ajan sonraki calismada SQL'i
  ayni hale getirir.
