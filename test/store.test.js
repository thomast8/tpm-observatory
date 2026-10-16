import assert from 'node:assert/strict';
import test from 'node:test';
import { SampleStore } from '../src/store.js';

test('persists and returns newest samples first', () => {
  const store = new SampleStore(':memory:');
  store.add(sample({ measuredAt: '2026-10-15T10:00:00.000Z', tpm: 100 }));
  store.add(sample({ measuredAt: '2026-10-16T10:00:00.000Z', tpm: 200 }));
  assert.deepEqual(
    store.list().map((item) => item.tpm),
    [200, 100],
  );
  store.close();
});

function sample(overrides) {
  return {
    model: 'gpt-test',
    displayName: 'GPT Test',
    effort: 'low',
    measuredAt: '2026-10-16T10:00:00.000Z',
    durationMs: 30_000,
    outputTokens: 100,
    reasoningOutputTokens: 10,
    tpm: 200,
    ...overrides,
  };
}

