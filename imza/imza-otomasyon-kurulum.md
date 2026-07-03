# Imza otomasyonuna gecis notu

Bu tasarimda Google Sheet artik sadece rapor uretmez; IK/IT tarafindan isaretlenen satirlari bir is kuyruğuna cevirir.

## Ana sayfa kolonlari

Ana sayfada su kolon basliklari olmasi yeterli:

```text
Kampüs
Mail
İsim
Ünvan
Title
url
Resim linki
GAM Kodu
Adres
CampusImage
İşleme Al
Durum
Son İşlem
```

Kolonlarin sirasini degistirebilirsin. Apps Script baslik adlarini bulup calisir.

## IK / IT kullanimi

1. IK veya IT sadece `Ünvan` secer.
2. Gerekirse `Kampüs` kontrol edilir.
3. `İşleme Al` checkbox'i secilir.
4. `Export Tools > İşleme alınan imzaları üret` calistirilir.

Script sadece `İşleme Al` secili satirlari isler.

## Scriptin uretecegi dosyalar

Script uc cikti uretir:

```text
Photoshop_Dataset_yyyy-MM-dd_HHmmss.txt
id.html
gam_imza_yyyy-MM-dd_HHmmss.cmd
```

Photoshop TXT eski degisken sisteminle ayni kolonlari tasir:

```text
filename	ad	unvan	ing	email	adres	CampusImage
```

HTML dosyasi su URL mantigi ile olusur:

```text
https://istek.site/imza/{id}/{id}.jpg
```

GAM komutu su mantikta olusur:

```bat
gam user "personel@istek.k12.tr" signature file "signature/id.html" html
```

## Windows tarafi

Google Drive for Desktop ile bu klasorler bilgisayara dustukten sonra Gorev Zamanlayici su sirayla calismali:

```text
1. Photoshop dataset'i isle ve JPG uret
2. JPG dosyalarini /imza/{id}/{id}.jpg olarak siteye yukle
3. C:\GAMWork altindaki gam_imza_*.cmd dosyasini calistir
4. Basariliysa Sheet'te Durum alanini Basıldı yap
```

FileZilla yerine WinSCP komut satiri tercih edilirse upload kismi daha stabil ve loglanabilir olur.

## Onemli

Google Apps Script senin bilgisayarindaki Photoshop, GAM veya FileZilla'yi dogrudan calistiramaz. Bu yuzden Sheet sadece dosya uretir; yerel bilgisayar otomasyonu Drive Sync ile gelen dosyalari isler.
