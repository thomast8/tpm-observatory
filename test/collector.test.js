import assert from 'node:assert/strict';
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCollector, statusWithoutTranscript } from '../src/collector.js';
import { SampleStore } from '../src/store.js';

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

test('session shutdown collects the last marked turn once without turn or model input', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'tpm-finalize-test-'));
  const transcriptPath = join(dataDir, 'transcript.jsonl');
  await writeFile(transcriptPath, '');
  const input = { session_id: 'session-1', turn_id: 'turn-1', model: 'gpt-test', transcript_path: transcriptPath };
  await runCollector('mark', input, dataDir);
  await appendFile(transcriptPath, [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    { type: 'token_usage_record', payload: { turn_id: 'turn-1', turn_token_usage: { output_tokens: 100, reasoning_output_tokens: 10 } } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1', completed_at: 1_760_000_000, duration_ms: 1_000 } },
  ].map((record) => JSON.stringify(record)).join('\n'));
  const ending = { session_id: input.session_id, transcript_path: transcriptPath };
  const sample = await runCollector('finalize', ending, dataDir);
  assert.equal(sample.turnId, 'turn-1');
  assert.equal(sample.model, 'gpt-test');
  assert.equal(sample.tpm, 6_000);
  await runCollector('collect', input, dataDir);
  await runCollector('finalize', ending, dataDir);
  assert.equal(await runCollector('finalize', { ...ending, session_id: 'unmarked' }, dataDir), null);
  const store = new SampleStore(join(dataDir, 'samples.sqlite'));
  assert.equal(store.list().length, 1);
  assert.equal(store.getCollectorStatus().state, 'active');
  store.close();
});

