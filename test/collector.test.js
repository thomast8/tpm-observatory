import assert from 'node:assert/strict';
import test from 'node:test';
import { statusWithoutTranscript } from '../src/collector.js';

test('skipping a Cloud turn does not downgrade a healthy local collector', () => {
  assert.deepEqual(statusWithoutTranscript({ lastSampleAt: '2026-10-16T17:31:42.000Z' }), {
    state: 'active',
    message: 'Collecting completed local Codex turns automatically.',
  });
  assert.deepEqual(statusWithoutTranscript(undefined), {
    state: 'waiting',
    message: 'Waiting for a completed local Codex turn.',
  });
});

