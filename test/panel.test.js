import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panel = await readFile(new URL('../src/panel.html', import.meta.url), 'utf8');

test('polls only while visible and refreshes when visibility returns', () => {
  assert.match(panel, /setInterval\(\(\) => void refreshDashboard\(true\), 5_000\)/);
  assert.match(panel, /document\.visibilityState !== 'visible'/);
  assert.match(panel, /visibilitychange/);
});

test('switches every throughput display between TPM and TPS', () => {
  assert.match(panel, /data-unit="minute"/);
  assert.match(panel, /data-unit="second"/);
  assert.match(panel, /tpm \/ 60/);
  assert.match(panel, /metricNumber\(stats\?\.average\)/);
  assert.match(panel, /metricNumber\(stats\?\.min\)/);
  assert.match(panel, /metricNumber\(stats\?\.max\)/);
  assert.match(panel, /Reasoning efforts are pooled within each model and speed tier/);
  assert.doesNotMatch(panel, /model\.effortLabel/);
  assert.doesNotMatch(panel, /tpm_benchmark/);
});

