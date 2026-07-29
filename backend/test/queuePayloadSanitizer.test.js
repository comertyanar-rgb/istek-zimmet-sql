import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSafeOperationPayload } from '../src/queuePayloadSanitizer.js';

test('tamamlanan PDF payload özeti el yazısı beyanı, OTP ve iletişim verisini taşımaz', () => {
  const summary = buildSafeOperationPayload(
    'GENERATE_ZIMMET_PDF',
    {
      documentType: 'zimmet',
      pdfName: 'zimmet.pdf',
      campus: 'Genel Müdürlük',
      requestedBy: 'it@istek.k12.tr',
      itEmail: 'it@istek.k12.tr',
      clientIp: '192.0.2.10',
      userAgent: 'secret-agent',
      person: {
        id: 'person-1',
        name: 'Test Personel',
        email: 'personel@istek.k12.tr',
        phone: '5555555555',
        campus: 'Genel Müdürlük',
        department: 'Öğretmen'
      },
      hardware: [{ hardwareId: 10, serial: 'SERIAL-1', brand: 'Lenovo', model: 'T14' }],
      statements: {
        person: { image: 'data:image/png;base64,PERSON', text: 'Gizli personel beyanı' },
        it: { image: 'data:image/png;base64,IT', text: 'Gizli IT beyanı' },
        otpHash: 'DİJİTAL-ONAY-SECRET'
      },
      email: { to: 'personel@istek.k12.tr', body: 'Gizli gövde' },
      zimmetExplanation: 'Özel açıklama'
    },
    new Date('2026-07-11T10:00:00.000Z')
  );

  assert.equal(summary.payloadRedacted, true);
  assert.equal(summary.redactedAt, '2026-07-11T10:00:00.000Z');
  assert.equal(summary.person.name, 'Test Personel');
  assert.equal(summary.hardware[0].serial, 'SERIAL-1');
  assert.equal(summary.hardwareCount, 1);

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /base64|otpHash|DİJİTAL-ONAY|Gizli personel beyanı|Gizli IT beyanı|personel@|192\.0\.2\.10|Gizli gövde|Özel açıklama/);
});
