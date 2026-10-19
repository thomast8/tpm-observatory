import { tokensPerMinute } from './stats.js';

const MODEL_ITEM_TYPES = new Set(['Reasoning', 'AgentMessage', 'ContextCompaction']);

export function parseTurnTelemetry(text, hook) {
  let effort = 'unknown';
  let serviceTier = 'default';
  let lastSeenTier = 'default';
  let targetStarted = false;
  let usage = null;
  let completion = null;
  let activeDurationMs = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = record?.payload;
    if (!payload) continue;
    if (record.type === 'event_msg' && payload.type === 'thread_settings_applied') {
      lastSeenTier = normalizeTier(payload.thread_settings?.service_tier);
      if (targetStarted) serviceTier = lastSeenTier;
      continue;
    }
    if (record.type === 'event_msg' && payload.type === 'task_started') {
      targetStarted = payload.turn_id === hook.turnId;
      if (targetStarted) serviceTier = lastSeenTier;
    }
    if (payload.turn_id !== hook.turnId) continue;
    if (record.type === 'turn_context') {
      effort = typeof payload.effort === 'string' ? payload.effort : effort;
    } else if (record.type === 'token_usage_record') {
      usage = validUsage(payload.turn_token_usage) ? payload.turn_token_usage : usage;
    } else if (record.type === 'event_msg' && payload.type === 'item_completed') {
      if (MODEL_ITEM_TYPES.has(payload.item?.type)) {
        const duration = payload.completed_at_ms - payload.started_at_ms;
        if (Number.isSafeInteger(duration) && duration > 0) activeDurationMs += duration;
      }
    } else if (record.type === 'event_msg' && payload.type === 'task_complete') {
      completion = payload;
      targetStarted = false;
    }
  }
  if (!completion || !usage || activeDurationMs <= 0) return null;
  return {
    model: hook.model,
    displayName: hook.model,
    effort,
    serviceTier,
    measuredAt: recordTime(completion.completed_at),
    durationMs: activeDurationMs,
    turnDurationMs: positiveInteger(completion.duration_ms) ? completion.duration_ms : null,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
    tpm: tokensPerMinute(usage.output_tokens, activeDurationMs),
    source: 'observed',
    sessionId: hook.sessionId,
    turnId: hook.turnId,
  };
}

function normalizeTier(value) {
  return typeof value === 'string' && value.trim() ? value : 'default';
}

function validUsage(usage) {
  return (
    usage &&
    positiveInteger(usage.output_tokens) &&
    Number.isSafeInteger(usage.reasoning_output_tokens) &&
    usage.reasoning_output_tokens >= 0
  );
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function recordTime(unixSeconds) {
  return positiveInteger(unixSeconds) ? new Date(unixSeconds * 1_000).toISOString() : new Date().toISOString();
}

