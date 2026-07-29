# Windows Servis ve SQL Yedekleme Görevleri

## Backend başlangıç görevi

SQL API ve PDF worker aynı Node backend süreci içinde çalışır. Canlı kullanımda
backend'i açık bir PowerShell penceresinde bırakmak yerine sessiz Windows görevi
olarak çalıştırın.

Önce backend `.env` dosyasının hazır olduğunu ve elle çalıştığını doğrulayın:

```powershell
cd backend
npm install
npm start
```

Sağlık kontrolü:

```text
http://localhost:8787/health
```

Sessiz başlangıç görevi kurmak veya güncellemek için:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Install-BackendStartupTask.ps1"
```

Bilgisayar açılışında çalışması gerekiyorsa `-AtStartup` ekleyin. Görünür pencere
yalnız teşhis için `-Visible` ile açılmalıdır. Varsayılan çalışma sessizdir ve log
dosyası `C:\ZimmetBackend\backend.log` yolundadır.

## SQL Server tam yedekleme

SQL Server Express'te SQL Server Agent bulunmadığı için yedekleme Windows Görev
Zamanlayıcı ile yapılır. Eklenen akış:

1. Veritabanının `COPY_ONLY` tam yedeğini alır.
2. Sayfa checksum'larını yedeğe dahil eder.
3. Aynı çalışmada `RESTORE VERIFYONLY WITH CHECKSUM` uygular.
4. Yalnızca `IstekZimmet_full_*.bak` kalıbına uyan ve saklama süresini aşan
   dosyaları, doğrulanmış yedek klasörü içinden siler.
5. Aynı veritabanı için iki yedek çalışmasının çakışmasını engeller.

### İlk manuel yedek

Normal PowerShell penceresinde önce tek bir yedek alın:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Backup-IstekZimmet.ps1"
```

Varsayılan yedek klasörü:

```text
C:\ZimmetBackup
```

SQL Server servis hesabının bu klasöre yazma izni yoksa manuel komut hata verir.
Aşağıdaki görev kurucusu yönetici olarak çalıştırıldığında gerekli klasör iznini
yerel SQL servisine kendisi verir.

### Günlük sessiz görevi kurma

PowerShell'i **Yönetici olarak çalıştırın** ve repo kökünde:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Install-SqlBackupTask.ps1" -RunNow
```

Varsayılanlar:

- Görev adı: `ISTEK Zimmet SQL Backup`
- Çalışma saati: her gün `02:00`
- Saklama süresi: `30` gün
- Yedek klasörü: `C:\ZimmetBackup`
- Kimlik doğrulama: görevi kuran Windows hesabı, S4U; SQL parolası saklanmaz
- Pencere: gizli

Saati ve saklama süresini değiştirme örneği:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Install-SqlBackupTask.ps1" `
  -DailyAt "01:30" `
  -RetentionDays 45 `
  -RunNow
```

Görevi çalıştıran Windows hesabının SQL Server'da yedek alma yetkisi bulunmalıdır.
Bu kurulumdaki SQL yöneticisi hesabıyla görev oluşturmak en dar ve kolay başlangıç
yoludur. Başka bir servis hesabına geçilecekse yalnız gereken SQL ve klasör
izinleri ayrıca verilmelidir.

`-UseCompression` varsayılan değildir. SQL Server sürümü/edition'ı destekliyorsa
kurulum ve manuel komuta bu anahtarı ekleyebilirsiniz.

### Durum kontrolü

```powershell
Get-ScheduledTask -TaskName "ISTEK Zimmet SQL Backup"
Get-ScheduledTaskInfo -TaskName "ISTEK Zimmet SQL Backup"
Get-ChildItem C:\ZimmetBackup\IstekZimmet_full_*.bak
Get-Content C:\ZimmetBackup\backup-history.log -Tail 20
```

`LastTaskResult` değeri `0` olmalıdır. İlk çalıştırmadan sonra `.bak` dosyasının
oluştuğunu ve logda `Backup tamamlandi ve dogrulandi` satırını mutlaka kontrol edin.

Türkçe Windows kültüründe Windows PowerShell 5.1'in ASCII `I` harfi için yaptığı
case-insensitive regex dönüşümünden etkilenmemek üzere sunucu/veritabanı adı
doğrulamaları açıkça case-sensitive çalışır. `sqlcmd` başarı mesajlarını stderr'e
yazsa bile karar `$LASTEXITCODE` üzerinden verilir; bu nedenle görevde yanlış
`LastTaskResult=1` oluşmaz.

### Mevcut yedeği tekrar doğrulama

En yeni yedeği doğrulamak için:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Verify-IstekZimmetBackup.ps1"
```

Belirli bir dosya için:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Verify-IstekZimmetBackup.ps1" `
  -BackupFile "C:\ZimmetBackup\IstekZimmet_full_20260711_020000.bak"
```

### Görevi kaldırma

Bu komut yalnız Görev Zamanlayıcı kaydını kaldırır; `.bak` dosyalarını silmez:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Remove-SqlBackupTask.ps1" -Confirm:$false
```

## Geri yükleme tatbikatı

`RESTORE VERIFYONLY`, yedek dosyasının okunabilirliğini ve checksum'larını kontrol
eder; gerçek geri yüklemenin yerini tamamen tutmaz. En az üç ayda bir otomatik
tatbikat scriptini çalıştırın:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\backend\windows\Test-IstekZimmetRestore.ps1"
```

Script en güncel yedeği benzersiz isimli geçici bir veritabanına, SQL Server'ın
varsayılan veri/log klasörlerine restore eder. `DBCC CHECKDB`, temel tablo
sayımları ve log zinciri kontrolünden sonra yalnız kendi oluşturduğu test
veritabanını siler. Üretim `IstekZimmet` veritabanını değiştirmez ve mevcut bir
veritabanının üzerine `REPLACE` kullanmaz. İnceleme için geçici veritabanını
korumak gerekirse bilinçli olarak `-KeepRestoredDatabase` verilebilir.

Elle restore ayrıntısını incelemek gerekirse önce mantıksal dosya adlarını alın:

```sql
RESTORE FILELISTONLY
FROM DISK = N'C:\ZimmetBackup\IstekZimmet_full_YYYYMMDD_HHMMSS.bak';
```

Çıktıdaki mantıksal veri ve log adlarını kullanarak üretimden farklı dosya yollarına
ve farklı veritabanı adına restore edin:

```sql
RESTORE DATABASE [IstekZimmet_RestoreTest]
FROM DISK = N'C:\ZimmetBackup\IstekZimmet_full_YYYYMMDD_HHMMSS.bak'
WITH
  MOVE N'FILELISTONLY_VERI_MANTIKSAL_ADI'
    TO N'C:\Program Files\Microsoft SQL Server\MSSQL\DATA\IstekZimmet_RestoreTest.mdf',
  MOVE N'FILELISTONLY_LOG_MANTIKSAL_ADI'
    TO N'C:\Program Files\Microsoft SQL Server\MSSQL\DATA\IstekZimmet_RestoreTest_log.ldf',
  RECOVERY;

DBCC CHECKDB ([IstekZimmet_RestoreTest]) WITH NO_INFOMSGS;
```

Dosya yolları kurulu SQL instance'ına göre değişir. Üretim `IstekZimmet`
veritabanının üzerine restore yapmayın.

## Yedek güvenliği

Tek diskteki yedek, disk arızasına karşı koruma sağlamaz. `C:\ZimmetBackup`
klasörünü BitLocker korumalı ikinci bir diske veya erişimi sınırlandırılmış kurum
depolamasına ayrıca kopyalayın. Yedek dosyaları personel ve demirbaş verisi içerir;
e-posta veya herkese açık paylaşım alanlarına konulmamalıdır.
