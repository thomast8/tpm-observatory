import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTurnTelemetry } from '../src/telemetry.js';

const hook = { sessionId: 'session-1', turnId: 'turn-1', model: 'gpt-test' };

test('extracts active model TPM and the Fast service tier', () => {
  const sample = parseTurnTelemetry(
    lines(
      event('thread_settings_applied', {
        thread_settings: { service_tier: 'priority' },
      }),
      event('task_started', { turn_id: 'turn-1' }),
      { type: 'turn_context', payload: { turn_id: 'turn-1', effort: 'high' } },
      item('turn-1', 'Reasoning', 1_000, 2_000),
      item('turn-1', 'AgentMessage', 2_000, 2_500),
      {
        type: 'token_usage_record',
        payload: {
          turn_id: 'turn-1',
          turn_token_usage: { output_tokens: 300, reasoning_output_tokens: 50 },
        },
      },
      event('task_complete', {
        turn_id: 'turn-1',
        completed_at: 1_760_000_000,
        duration_ms: 9_000,
      }),
      event('thread_settings_applied', {
        thread_settings: { service_tier: 'default' },
      }),
    ),
    hook,
  );
  assert.equal(sample.serviceTier, 'priority');
  assert.equal(sample.effort, 'high');
  assert.equal(sample.durationMs, 1_500);
  assert.equal(sample.turnDurationMs, 9_000);
  assert.equal(sample.tpm, 12_000);
  assert.equal(sample.source, 'observed');
});

test('keeps Ultra Fast distinct and ignores malformed or foreign records', () => {
  const sample = parseTurnTelemetry(
    `not-json\n${lines(
      event('thread_settings_applied', { thread_settings: { service_tier: 'ultra_fast' } }),
      event('task_started', { turn_id: 'turn-1' }),
      item('other-turn', 'Reasoning', 0, 5_000),
      item('turn-1', 'AgentMessage', 0, 1_000),
      {
        type: 'token_usage_record',
        payload: {
          turn_id: 'turn-1',
          turn_token_usage: { output_tokens: 100, reasoning_output_tokens: 0 },
        },
      },
      event('task_complete', { turn_id: 'turn-1', completed_at: 1_760_000_000, duration_ms: 1_500 }),
    )}`,
    hook,
  );
  assert.equal(sample.serviceTier, 'ultra_fast');
  assert.equal(sample.durationMs, 1_000);
  assert.equal(sample.tpm, 6_000);
});

test('fails closed until completion and final token usage are present', () => {
  assert.equal(parseTurnTelemetry(lines(item('turn-1', 'AgentMessage', 0, 1_000)), hook), null);
});

test('uses safe defaults and the last valid telemetry record', () => {
  const sample = parseTurnTelemetry(
    `\n${lines(
      { type: 'unknown' },
      event('thread_settings_applied', { thread_settings: { service_tier: '' } }),
      event('task_started', { turn_id: 'turn-1' }),
      item('turn-1', 'CommandExecution', 0, 5_000),
      item('turn-1', 'Reasoning', 10, 10),
      item('turn-1', 'AgentMessage', 0, 1_000),
      {
        type: 'token_usage_record',
        payload: {
          turn_id: 'turn-1',
          turn_token_usage: { output_tokens: 0, reasoning_output_tokens: -1 },
        },
      },
      {
        type: 'token_usage_record',
        payload: {
          turn_id: 'turn-1',
          turn_token_usage: { output_tokens: 60, reasoning_output_tokens: 2 },
        },
      },
      event('task_complete', { turn_id: 'turn-1', completed_at: null, duration_ms: 0 }),
    )}`,
    hook,
  );
  assert.equal(sample.serviceTier, 'default');
  assert.equal(sample.effort, 'unknown');
  assert.equal(sample.turnDurationMs, null);
  assert.match(sample.measuredAt, /^\d{4}-\d{2}-\d{2}T/);
});

function event(type, payload) {
  return { type: 'event_msg', payload: { type, ...payload } };
}

function item(turnId, type, started, completed) {
  return event('item_completed', {
    turn_id: turnId,
    started_at_ms: started,
    completed_at_ms: completed,
    item: { type },
  });
}

function lines(...records) {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

