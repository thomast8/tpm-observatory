import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { SampleStore } from '../src/store.js';

test('persists and returns newest samples first', () => {
  const store = new SampleStore(':memory:');
  store.add(sample({ measuredAt: '2026-10-15T10:00:00.000Z', tpm: 100 }));
  store.add(sample({ turnId: 'turn-2', measuredAt: '2026-10-16T10:00:00.000Z', tpm: 200 }));
  store.add(sample({ source: 'benchmark', sessionId: null, turnId: null, tpm: 999 }));
  assert.deepEqual(
    store.list().map((item) => item.tpm),
    [200, 100],
  );
  assert.deepEqual(store.list(10, 'benchmark').map((item) => item.tpm), [999]);
  assert.equal(store.add(sample({ turnId: 'turn-2', tpm: 300 })), false);
  store.close();
});

test('keeps turn offsets and collector health', () => {
  const store = new SampleStore(':memory:');
  store.markTurn({
    sessionId: 'session-1',
    turnId: 'turn-1',
    transcriptPath: '/tmp/transcript.jsonl',
    startOffset: 42,
    model: 'gpt-test',
    createdAt: '2026-10-16T10:00:00.000Z',
  });
  assert.deepEqual({ ...store.getTurn('session-1', 'turn-1') }, {
    transcriptPath: '/tmp/transcript.jsonl',
    startOffset: 42,
    model: 'gpt-test',
  });
  assert.equal(store.getCollectorStatus(), undefined);
  store.setCollectorStatus('active', 'Collecting.', '2026-10-16T10:01:00.000Z');
  store.setCollectorStatus('waiting', 'Waiting.');
  assert.equal(store.getCollectorStatus().lastSampleAt, '2026-10-16T10:01:00.000Z');
  store.close();
});

test('migrates the 0.1 sample schema without deleting its benchmark row', () => {
  const path = '/private/tmp/tpm-observatory-legacy-test.sqlite';
  const database = new DatabaseSync(path);
  database.exec(`DROP TABLE IF EXISTS samples;
    DROP TABLE IF EXISTS turn_offsets;
    DROP TABLE IF EXISTS collector_status;
    CREATE TABLE samples (
      id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      display_name TEXT NOT NULL,
      effort TEXT NOT NULL,
      measured_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      reasoning_output_tokens INTEGER NOT NULL,
      tpm REAL NOT NULL
    );
    INSERT INTO samples VALUES (
      1, 'gpt-old', 'GPT Old', 'low', '2026-10-15T10:00:00.000Z', 1000, 10, 1, 600
    )`);
  database.close();
  const store = new SampleStore(path);
  const migrated = store.list(10, 'benchmark')[0];
  assert.equal(migrated.model, 'gpt-old');
  assert.equal(migrated.serviceTier, 'default');
  assert.equal(store.getTurn('missing', 'missing'), undefined);
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
    source: 'observed',
    serviceTier: 'priority',
    sessionId: 'session-1',
    turnId: 'turn-1',
    turnDurationMs: 35_000,
    ...overrides,
  };
}

