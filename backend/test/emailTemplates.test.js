import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDocumentEmail,
  buildOtpEmail,
  buildTransferEmail,
} from '../src/emailTemplates.js';

test('OTP e-postası kişi, işlem ve gerçek geçerlilik süresini içerir', () => {
  const email = buildOtpEmail({
    personName: 'Cömert Yanar',
    code: '763489',
    action: 'return',
    expiresMinutes: 3,
  });

  assert.match(email.subject, /Donanım İade Onay Kodu/);
  assert.match(email.body, /Sayın Cömert Yanar/);
  assert.match(email.body, /763489/);
  assert.match(email.body, /3 dakika geçerlidir/);
  assert.match(email.htmlBody, /Cömert Yanar/);
  assert.match(email.htmlBody, /763489/);
  assert.match(email.htmlBody, /Bilgi İşlem Demirbaş Yönetim Sistemi/);
});

test('zimmet belge e-postası kurumsal işlem ayrıntılarını içerir', () => {
  const email = buildDocumentEmail({
    personName: 'Musa Bozan',
    isReturn: false,
    hardwareCount: 2,
    campus: 'Konyaaltı Kampüsü',
    operatorName: 'Cem Soydaş',
  });

  assert.match(email.subject, /Donanım Zimmet Belgeniz/);
  assert.match(email.body, /Sayın Musa Bozan/);
  assert.match(email.body, /2 adet donanıma/);
  assert.match(email.body, /Konyaaltı Kampüsü/);
  assert.match(email.body, /Cem Soydaş/);
  assert.match(email.htmlBody, /Donanım sayısı/);
  assert.match(email.htmlBody, /2 adet/);
});

test('transfer e-postası rota ve cihaz sayısını içerir', () => {
  const email = buildTransferEmail({
    direction: 'out',
    senderCampus: 'Acıbadem Kampüsü',
    receiverCampus: 'Genel Müdürlük',
    hardwareCount: 4,
  });

  assert.match(email.subject, /Cihaz Transferi Başlatıldı/);
  assert.match(email.body, /Acıbadem Kampüsü/);
  assert.match(email.body, /Genel Müdürlük/);
  assert.match(email.body, /4 adet donanım/);
  assert.match(email.htmlBody, /Gönderen kampüs/);
  assert.match(email.htmlBody, /Alıcı kampüs/);
});
