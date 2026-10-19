import { tokensPerMinute } from './stats.js';

const MODEL_ITEM_TYPES = new Set(['Reasoning', 'AgentMessage', 'ContextCompaction']);

export function parseTurnTelemetry(text, hook) {
  let effort = 'unknown';
  let serviceTier = 'default';
  let lastSeenTier = 'default';
  let targetStarted = false;
  let usage = null;
  let completion = null;
  let modelItemDurationMs = 0;
  const excludedIntervals = [];
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
      const interval = validInterval(payload.started_at_ms, payload.completed_at_ms);
      if (!interval) continue;
      if (MODEL_ITEM_TYPES.has(payload.item?.type)) modelItemDurationMs += interval[1] - interval[0];
      else excludedIntervals.push(interval);
    } else if (record.type === 'event_msg' && payload.type === 'task_complete') {
      completion = payload;
      targetStarted = false;
    }
  }
  const turnDurationMs = positiveInteger(completion?.duration_ms) ? completion.duration_ms : null;
  const activeDurationMs = turnDurationMs
    ? turnDurationMs - mergedDuration(excludedIntervals)
    : modelItemDurationMs;
  if (!completion || !usage || activeDurationMs <= 0) return null;
  return {
    model: hook.model,
    displayName: hook.model,
    effort,
    serviceTier,
    measuredAt: recordTime(completion.completed_at),
    durationMs: activeDurationMs,
    turnDurationMs,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
    tpm: tokensPerMinute(usage.output_tokens, activeDurationMs),
    source: 'observed',
    sessionId: hook.sessionId,
    turnId: hook.turnId,
  };
}

function validInterval(start, end) {
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start
    ? [start, end]
    : null;
}

function mergedDuration(intervals) {
  const sorted = intervals.toSorted((left, right) => left[0] - right[0]);
  let total = 0;
  let current = null;
  for (const interval of sorted) {
    if (!current || interval[0] > current[1]) {
      if (current) total += current[1] - current[0];
      current = [...interval];
    } else {
      current[1] = Math.max(current[1], interval[1]);
    }
  }
  return current ? total + current[1] - current[0] : total;
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

