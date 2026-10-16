import assert from 'node:assert/strict';
import test from 'node:test';
import { summarize, summarizeEfforts, tokensPerMinute } from '../src/stats.js';

test('computes observed tokens per minute', () => {
  assert.equal(tokensPerMinute(120, 30_000), 240);
  assert.throws(() => tokensPerMinute(0, 1_000), /positive integer/);
  assert.throws(() => tokensPerMinute(1, 0), /positive/);
});

test('summarizes a sample with a t confidence interval', () => {
  const result = summarize([120, 80, 100]);
  assert.equal(result.count, 3);
  assert.equal(result.average, 100);
  assert.equal(result.median, 100);
  assert.equal(result.min, 80);
  assert.equal(result.max, 120);
  assert.ok(result.ci95Low < 100);
  assert.ok(result.ci95High > 100);
});

test('handles empty and single-value samples', () => {
  assert.equal(summarize([]), null);
  assert.deepEqual(summarize([42]), {
    count: 1,
    average: 42,
    median: 42,
    min: 42,
    max: 42,
    ci95Low: null,
    ci95High: null,
  });
});

test('pools reasoning efforts without splitting the throughput series', () => {
  assert.deepEqual(summarizeEfforts([]), { efforts: [], label: 'No observations' });
  assert.deepEqual(summarizeEfforts(['high', 'high']), {
    efforts: ['high'],
    label: 'high effort',
  });
  assert.deepEqual(summarizeEfforts(['low', 'high', 'low']), {
    efforts: ['low', 'high'],
    label: 'Mixed effort',
  });
});

