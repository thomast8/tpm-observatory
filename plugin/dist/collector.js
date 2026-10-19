// src/collector.js
import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/store.js
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
var SampleStore = class {
  constructor(path) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true, mode: 448 });
      closeSync(openSync(path, "a", 384));
    }
    this.database = new DatabaseSync(path, { timeout: 5e3 });
    this.database.exec(`CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      display_name TEXT NOT NULL,
      effort TEXT NOT NULL,
      measured_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
      output_tokens INTEGER NOT NULL CHECK (output_tokens > 0),
      reasoning_output_tokens INTEGER NOT NULL CHECK (reasoning_output_tokens >= 0),
      tpm REAL NOT NULL CHECK (tpm > 0),
      source TEXT NOT NULL DEFAULT 'observed',
      service_tier TEXT NOT NULL DEFAULT 'default',
      session_id TEXT,
      turn_id TEXT,
      turn_duration_ms INTEGER
    );
    CREATE TABLE IF NOT EXISTS turn_offsets (
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      transcript_path TEXT NOT NULL,
      start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
      model TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, turn_id)
    );
    CREATE TABLE IF NOT EXISTS collector_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL,
      message TEXT NOT NULL,
      last_attempt_at TEXT NOT NULL,
      last_sample_at TEXT
    )`);
    this.migrateSamples();
    this.database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS observed_turn
      ON samples(session_id, turn_id)
      WHERE source = 'observed' AND turn_id IS NOT NULL`);
  }
  add(sample) {
    const result = this.database.prepare(`INSERT OR IGNORE INTO samples (
        model, display_name, effort, measured_at, duration_ms,
        output_tokens, reasoning_output_tokens, tpm, source, service_tier,
        session_id, turn_id, turn_duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sample.model,
      sample.displayName,
      sample.effort,
      sample.measuredAt,
      sample.durationMs,
      sample.outputTokens,
      sample.reasoningOutputTokens,
      sample.tpm,
      sample.source ?? "observed",
      sample.serviceTier ?? "default",
      sample.sessionId ?? null,
      sample.turnId ?? null,
      sample.turnDurationMs ?? null
    );
    return result.changes > 0;
  }
  list(limit = 2e3, source = "observed") {
    return this.database.prepare(`SELECT
        model,
        display_name AS displayName,
        effort,
        measured_at AS measuredAt,
        duration_ms AS durationMs,
        output_tokens AS outputTokens,
        reasoning_output_tokens AS reasoningOutputTokens,
        tpm,
        source,
        service_tier AS serviceTier,
        session_id AS sessionId,
        turn_id AS turnId,
        turn_duration_ms AS turnDurationMs
      FROM samples
      WHERE source = ?
      ORDER BY measured_at DESC
      LIMIT ?`).all(source, limit);
  }
  markTurn(turn) {
    this.database.prepare(`INSERT OR IGNORE INTO turn_offsets (
        session_id, turn_id, transcript_path, start_offset, model, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`).run(
      turn.sessionId,
      turn.turnId,
      turn.transcriptPath,
      turn.startOffset,
      turn.model,
      turn.createdAt
    );
  }
  getTurn(sessionId, turnId) {
    return this.database.prepare(`SELECT
        transcript_path AS transcriptPath,
        start_offset AS startOffset,
        model
      FROM turn_offsets
      WHERE session_id = ? AND turn_id = ?`).get(sessionId, turnId);
  }
  setCollectorStatus(state, message, lastSampleAt = null) {
    const previous = this.getCollectorStatus();
    this.database.prepare(`INSERT OR REPLACE INTO collector_status (
        id, state, message, last_attempt_at, last_sample_at
      ) VALUES (1, ?, ?, ?, ?)`).run(state, message, (/* @__PURE__ */ new Date()).toISOString(), lastSampleAt ?? previous?.lastSampleAt ?? null);
  }
  getCollectorStatus() {
    return this.database.prepare(`SELECT
        state,
        message,
        last_attempt_at AS lastAttemptAt,
        last_sample_at AS lastSampleAt
      FROM collector_status
      WHERE id = 1`).get();
  }
  close() {
    if (this.database.isOpen) this.database.close();
  }
  migrateSamples() {
    const columns = new Set(
      this.database.prepare("PRAGMA table_info(samples)").all().map((column) => column.name)
    );
    const additions = {
      source: "TEXT NOT NULL DEFAULT 'benchmark'",
      service_tier: "TEXT NOT NULL DEFAULT 'default'",
      session_id: "TEXT",
      turn_id: "TEXT",
      turn_duration_ms: "INTEGER"
    };
    for (const [name, definition] of Object.entries(additions)) {
      if (!columns.has(name)) this.database.exec(`ALTER TABLE samples ADD COLUMN ${name} ${definition}`);
    }
  }
};

// src/stats.js
function tokensPerMinute(outputTokens, durationMs) {
  if (!Number.isSafeInteger(outputTokens) || outputTokens <= 0) {
    throw new Error("Output tokens must be a positive integer");
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("Duration must be positive");
  }
  return outputTokens * 6e4 / durationMs;
}

// src/telemetry.js
var MODEL_ITEM_TYPES = /* @__PURE__ */ new Set(["Reasoning", "AgentMessage", "ContextCompaction"]);
function parseTurnTelemetry(text, hook) {
  let effort = "unknown";
  let serviceTier = "default";
  let lastSeenTier = "default";
  let targetStarted = false;
  let usage = null;
  let completion = null;
  let activeDurationMs = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = record?.payload;
    if (!payload) continue;
    if (record.type === "event_msg" && payload.type === "thread_settings_applied") {
      lastSeenTier = normalizeTier(payload.thread_settings?.service_tier);
      if (targetStarted) serviceTier = lastSeenTier;
      continue;
    }
    if (record.type === "event_msg" && payload.type === "task_started") {
      targetStarted = payload.turn_id === hook.turnId;
      if (targetStarted) serviceTier = lastSeenTier;
    }
    if (payload.turn_id !== hook.turnId) continue;
    if (record.type === "turn_context") {
      effort = typeof payload.effort === "string" ? payload.effort : effort;
    } else if (record.type === "token_usage_record") {
      usage = validUsage(payload.turn_token_usage) ? payload.turn_token_usage : usage;
    } else if (record.type === "event_msg" && payload.type === "item_completed") {
      if (MODEL_ITEM_TYPES.has(payload.item?.type)) {
        const duration = payload.completed_at_ms - payload.started_at_ms;
        if (Number.isSafeInteger(duration) && duration > 0) activeDurationMs += duration;
      }
    } else if (record.type === "event_msg" && payload.type === "task_complete") {
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
    source: "observed",
    sessionId: hook.sessionId,
    turnId: hook.turnId
  };
}
function normalizeTier(value) {
  return typeof value === "string" && value.trim() ? value : "default";
}
function validUsage(usage) {
  return usage && positiveInteger(usage.output_tokens) && Number.isSafeInteger(usage.reasoning_output_tokens) && usage.reasoning_output_tokens >= 0;
}
function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function recordTime(unixSeconds) {
  return positiveInteger(unixSeconds) ? new Date(unixSeconds * 1e3).toISOString() : (/* @__PURE__ */ new Date()).toISOString();
}

// src/collector.js
var MAX_TURN_BYTES = 64 * 1024 * 1024;
async function runCollector(action, input, dataDir) {
  const hook = validateInput(input);
  const store = new SampleStore(resolve(dataDir, "samples.sqlite"));
  try {
    if (action === "mark") return await markTurn(store, hook);
    if (action === "collect") return await collectTurn(store, hook);
    throw new Error("Unknown collector action");
  } catch (error) {
    store.setCollectorStatus("error", "Background collection needs attention.");
    throw error;
  } finally {
    store.close();
  }
}
async function markTurn(store, hook) {
  if (!hook.transcriptPath) return;
  const details = await stat(hook.transcriptPath);
  if (!details.isFile()) throw new Error("Hook transcript is not a file");
  store.markTurn({ ...hook, startOffset: details.size, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
}
async function collectTurn(store, hook) {
  if (!hook.transcriptPath) {
    const previous = store.getCollectorStatus();
    const status = statusWithoutTranscript(previous);
    store.setCollectorStatus(status.state, status.message);
    return null;
  }
  const marked = store.getTurn(hook.sessionId, hook.turnId);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const text = await readTurnChunk(hook.transcriptPath, marked?.startOffset);
    const sample = parseTurnTelemetry(text, hook);
    if (sample) {
      store.add(sample);
      store.setCollectorStatus(
        "active",
        "Collecting completed local Codex turns automatically.",
        sample.measuredAt
      );
      return sample;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
  }
  store.setCollectorStatus("waiting", "Waiting for final telemetry from the latest turn.");
  return null;
}
function statusWithoutTranscript(previous) {
  return previous?.lastSampleAt ? { state: "active", message: "Collecting completed local Codex turns automatically." } : { state: "waiting", message: "Waiting for a completed local Codex turn." };
}
async function readTurnChunk(path, requestedOffset) {
  const details = await stat(path);
  if (!details.isFile()) throw new Error("Hook transcript is not a file");
  const fallback = Math.max(0, details.size - MAX_TURN_BYTES);
  const start = requestedOffset !== void 0 && requestedOffset <= details.size ? requestedOffset : fallback;
  const length = details.size - start;
  if (length > MAX_TURN_BYTES) throw new Error("Turn telemetry exceeds the 64 MiB safety limit");
  const buffer = Buffer.alloc(length);
  const file = await open(path, "r");
  try {
    await file.read(buffer, 0, length, start);
  } finally {
    await file.close();
  }
  return buffer.toString("utf8");
}
function validateInput(input) {
  if (!input || typeof input !== "object") throw new Error("Hook input is unavailable");
  const sessionId = requiredString(input.session_id, "session id", 256);
  const turnId = requiredString(input.turn_id, "turn id", 256);
  const model = requiredString(input.model, "model", 256);
  const transcriptPath = input.transcript_path === null ? null : requiredString(input.transcript_path, "transcript path", 4096);
  return { sessionId, turnId, model, transcriptPath };
}
function requiredString(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`Hook ${label} is unavailable`);
  }
  return value;
}
async function main() {
  const input = await readStdin();
  const action = process.argv[2];
  const dataDir = process.env.PLUGIN_DATA || resolve(".data");
  await runCollector(action, JSON.parse(input), dataDir);
  if (action === "collect") process.stdout.write("{}");
}
async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 65536) throw new Error("Hook input is too large");
  }
  return input;
}
var invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    if (process.argv[2] === "collect") process.stdout.write("{}");
    process.exitCode = 1;
  });
}
export {
  runCollector,
  statusWithoutTranscript
};
