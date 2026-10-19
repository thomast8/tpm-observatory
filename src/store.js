import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class SampleStore {
  constructor(path) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      closeSync(openSync(path, 'a', 0o600));
    }
    this.database = new DatabaseSync(path, { timeout: 5_000 });
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
    const result = this.database
      .prepare(`INSERT OR IGNORE INTO samples (
        model, display_name, effort, measured_at, duration_ms,
        output_tokens, reasoning_output_tokens, tpm, source, service_tier,
        session_id, turn_id, turn_duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        sample.model,
        sample.displayName,
        sample.effort,
        sample.measuredAt,
        sample.durationMs,
        sample.outputTokens,
        sample.reasoningOutputTokens,
        sample.tpm,
        sample.source ?? 'observed',
        sample.serviceTier ?? 'default',
        sample.sessionId ?? null,
        sample.turnId ?? null,
        sample.turnDurationMs ?? null,
      );
    return result.changes > 0;
  }

  list(limit = 2_000, source = 'observed') {
    return this.database
      .prepare(`SELECT
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
      LIMIT ?`)
      .all(source, limit);
  }

  markTurn(turn) {
    this.database
      .prepare(`INSERT OR IGNORE INTO turn_offsets (
        session_id, turn_id, transcript_path, start_offset, model, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        turn.sessionId,
        turn.turnId,
        turn.transcriptPath,
        turn.startOffset,
        turn.model,
        turn.createdAt,
      );
  }

  getTurn(sessionId, turnId) {
    return this.database
      .prepare(`SELECT
        transcript_path AS transcriptPath,
        start_offset AS startOffset,
        model
      FROM turn_offsets
      WHERE session_id = ? AND turn_id = ?`)
      .get(sessionId, turnId);
  }

  setCollectorStatus(state, message, lastSampleAt = null) {
    const previous = this.getCollectorStatus();
    this.database
      .prepare(`INSERT OR REPLACE INTO collector_status (
        id, state, message, last_attempt_at, last_sample_at
      ) VALUES (1, ?, ?, ?, ?)`)
      .run(state, message, new Date().toISOString(), lastSampleAt ?? previous?.lastSampleAt ?? null);
  }

  getCollectorStatus() {
    return this.database
      .prepare(`SELECT
        state,
        message,
        last_attempt_at AS lastAttemptAt,
        last_sample_at AS lastSampleAt
      FROM collector_status
      WHERE id = 1`)
      .get();
  }

  close() {
    if (this.database.isOpen) this.database.close();
  }

  migrateSamples() {
    const columns = new Set(
      this.database.prepare('PRAGMA table_info(samples)').all().map((column) => column.name),
    );
    const additions = {
      source: "TEXT NOT NULL DEFAULT 'benchmark'",
      service_tier: "TEXT NOT NULL DEFAULT 'default'",
      session_id: 'TEXT',
      turn_id: 'TEXT',
      turn_duration_ms: 'INTEGER',
    };
    for (const [name, definition] of Object.entries(additions)) {
      if (!columns.has(name)) this.database.exec(`ALTER TABLE samples ADD COLUMN ${name} ${definition}`);
    }
  }
}
