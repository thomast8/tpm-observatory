import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const panel = await readFile(new URL('../src/panel.html', import.meta.url), 'utf8');

test('polls only while visible and refreshes when visibility returns', () => {
  assert.match(panel, /setInterval\(\(\) => void refreshDashboard\(true\), 5_000\)/);
  assert.match(panel, /document\.visibilityState !== 'visible'/);
  assert.match(panel, /visibilitychange/);
});

test('switches every throughput display between TPM and TPS', () => {
  assert.match(panel, /let unit = 'second'/);
  assert.match(panel, /data-unit="minute"/);
  assert.match(panel, /data-unit="second"/);
  assert.match(panel, /tpm \/ 60/);
  assert.match(panel, /metricNumber\(stats\?\.average\)/);
  assert.match(panel, /metricNumber\(stats\?\.min\)/);
  assert.match(panel, /metricNumber\(stats\?\.max\)/);
  assert.match(panel, /Reasoning efforts are pooled within each model/);
  assert.doesNotMatch(panel, /model\.effortLabel/);
  assert.doesNotMatch(panel, /tpm_benchmark/);
});

test('renders average, interval, median and range in both units with consistent series colour', () => {
  let click;
  const app = { innerHTML: '', clientWidth: 428, addEventListener(event, handler) { if (event === 'click') click = handler; } };
  const toast = { textContent: '', classList: { add() {}, remove() {} } };
  const context = {
    document: {
      querySelector: (selector) => selector === '#app' ? app : toast,
      addEventListener() {}, visibilityState: 'visible',
    },
    window: { parent: { postMessage() {} }, addEventListener() {} },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
  };
  const script = panel.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const sample = { tpm: 1200, measuredAt: '2026-10-16T17:00:00Z' };
  const model = {
    seriesId: 'test::priority', model: 'test', displayName: '<Test>', tierName: 'Fast',
    available: true, isDefault: false, latest: sample, samples: [sample],
    stats: { average: 1200, median: 1200, min: 600, max: 1800, count: 2, ci95Low: 900, ci95High: 1500 },
  };
  const slowerModel = {
    ...model,
    seriesId: 'slow::default', model: 'slow', displayName: 'Slower', tierName: 'Standard',
    stats: { ...model.stats, average: 600 },
  };
  context.fixture = {
    models: [slowerModel, model, { ...model, seriesId: 'ultra::ultra_fast', model: 'ultra', displayName: 'Ultra model', tierName: 'Ultra Fast' }], bestSeries: model.seriesId, runCount: 2,
    collector: { state: 'active' }, measurement: 'Output per minute',
  };
  const observed = runInNewContext(`${script}\ndashboard = fixture; tier = 'Fast'; render();
    const secondView = app.innerHTML; unit = 'minute'; render();
    ({ minuteView: app.innerHTML, secondView, colour: seriesColor(fixture.models[1]) });`, context);
  assert.match(observed.minuteView, /95% CI 900–1,500 · Median 1,200/);
  assert.match(observed.minuteView, /aria-label="Observed range 600 to 1,800; 95% confidence interval 900 to 1,500"/);
  assert.match(observed.minuteView, /class="confidence-fill" style="left:29%;width:42%;background:/);
  assert.match(observed.secondView, /95% CI 15–25 · Median 20/);
  assert.match(observed.secondView, /Min 10/);
  assert.match(observed.secondView, /Max 30/);
  assert.match(observed.secondView, /&lt;Test&gt;/);
  assert.ok(observed.secondView.includes(`stroke="${observed.colour}"`));
  assert.ok(observed.secondView.includes(`background:${observed.colour}`));
  assert.doesNotMatch(observed.secondView, />Slower</);
  assert.doesNotMatch(panel, /\.model-row .*display: none/);
  assert.ok(observed.secondView.indexOf('data-unit="second"') < observed.secondView.indexOf('data-unit="minute"'));
  click({ target: { closest: () => ({ dataset: { action: 'tier', tier: 'Ultra Fast' } }) } });
  assert.match(app.innerHTML, /data-tier="Ultra Fast" aria-pressed="true"/);
  assert.match(app.innerHTML, />Ultra model</);
  assert.doesNotMatch(app.innerHTML, />&lt;Test&gt;</);
  click({ target: { closest: () => ({ dataset: { action: 'tier', tier: 'Standard' } }) } });
  assert.match(app.innerHTML, />Slower</);
  assert.doesNotMatch(app.innerHTML, />Ultra model</);
});

test('uses one speed-tier toggle for the whole model list', () => {
  assert.match(panel, /aria-label="Speed tier"/);
  assert.match(panel, /data-tier="Standard"/);
  assert.match(panel, /data-tier="Fast"/);
  assert.match(panel, /model\.tierName === tier/);
  assert.doesNotMatch(panel, /class="tier tier-/);
});

