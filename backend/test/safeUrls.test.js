import assert from 'node:assert/strict';
import test from 'node:test';
import { toSafeDriveEmbedUrl, toSafeExternalUrl } from '../../src/utils/safeUrls.js';

test('çalıştırılabilir ve kimlik bilgili URL şemalarını reddeder', () => {
  assert.equal(toSafeExternalUrl('javascript:alert(1)'), '');
  assert.equal(toSafeExternalUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(toSafeExternalUrl('https://user:password@example.org/file.pdf'), '');
});

test('HTTP(S) bağlantısını kabul edip Drive önizlemesini kanonikleştirir', () => {
  assert.equal(toSafeExternalUrl('https://example.org/file.pdf'), 'https://example.org/file.pdf');
  assert.equal(
    toSafeDriveEmbedUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing'),
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview'
  );
  assert.equal(toSafeDriveEmbedUrl('https://example.org/file.pdf'), '');
});
