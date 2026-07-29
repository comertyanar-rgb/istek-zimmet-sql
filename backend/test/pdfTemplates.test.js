import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTransferDocumentHtml, buildZimmetDocumentHtml } from '../src/pdfTemplates.js';

test('zimmet şablonu iki sayfayı ve yönergeyi korur', () => {
  const html = buildZimmetDocumentHtml({
    documentType: 'zimmet',
    campus: 'Genel Müdürlük',
    person: { id: 'person-1', name: 'Test Personel', department: 'Öğretmen' },
    hardware: [{ type: 'Laptop', brand: 'Lenovo', model: 'T14', serial: '2.20299E+14' }],
    statements: {
      it: {
        image: 'data:image/png;base64,SVQ=',
        text: 'Eksiksiz teslim ettim.',
        hash: 'BEYAN-IT'
      },
      person: {
        image: 'data:image/png;base64,UEVSU09ORUw=',
        text: 'Okudum, eksiksiz teslim aldım ve onaylıyorum.',
        hash: 'BEYAN-PERSONEL'
      },
      otpHash: 'DİJİTAL-ONAY-TEST'
    },
    requestedBy: 'it@istek.k12.tr'
  });

  assert.match(html, /DONANIM ZİMMET TESLİM TUTANAĞI/);
  assert.match(html, /BİLGİ İŞLEM DİZÜSTÜ BİLGİSAYAR KULLANIM YÖNERGESİ/);
  assert.match(html, /page-break-before:always/);
  assert.match(html, />220299000000000</);
  assert.match(html, /Eksiksiz teslim ettim\./);
  assert.match(html, /Okudum, eksiksiz teslim aldım ve onaylıyorum\./);
  assert.match(html, /Beyan ID: BEYAN-IT/);
  assert.doesNotMatch(html, /imza/i);
});

test('PDF alanlarındaki HTML içeriğini metne dönüştürür', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const html = buildTransferDocumentHtml({
    transferDirection: 'out',
    senderCampus: attack,
    receiverCampus: 'Lara',
    itName: attack,
    hardware: [{ type: attack, brand: attack, model: 'Model', serial: attack }],
    statements: {
      transfer: {
        image: 'data:image/png;base64,VEVTVA==',
        text: 'Eksiksiz teslim ettim.',
        hash: 'BEYAN-TRANSFER'
      }
    }
  });

  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Teslim Eden Beyanı/);
  assert.match(html, /Beyan ID: BEYAN-TRANSFER/);
  assert.doesNotMatch(html, /imza/i);
});
