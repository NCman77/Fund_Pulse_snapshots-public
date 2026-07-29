import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialNavArchive } from '../src/funds/official-nav-archive.js';

test('official NAV archive contains only public disclosure provenance', () => {
  const archive = buildOfficialNavArchive({
    fundId: 'acdd04',
    fundName: '安聯台灣科技基金',
    capturedAt: '2026-07-29T10:35:00.000Z',
    nav: { date: '2026-07-29', value: 123.45, changeAmount: 1.23 },
    source: { name: 'moneydj-public', navUrl: 'https://example.test/nav' }
  }, 'data/funds/raw/ACDD04/2026/2026-07-29/1035.json');

  assert.deepEqual(archive, {
    schemaVersion: '1.0',
    fundId: 'ACDD04',
    fundName: '安聯台灣科技基金',
    officialNav: { date: '2026-07-29', value: 123.45, changeAmount: 1.23 },
    publishedAt: '2026-07-29T10:35:00.000Z',
    source: { name: 'moneydj-public', navUrl: 'https://example.test/nav' },
    sourceRawPath: 'data/funds/raw/ACDD04/2026/2026-07-29/1035.json'
  });
  assert.equal(buildOfficialNavArchive({ fundId: 'ACDD04', nav: { date: '', value: 123 } }), null);
});
