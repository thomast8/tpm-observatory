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
      tpm REAL NOT NULL CHECK (tpm > 0)
    )`);
  }

  add(sample) {
    this.database
      .prepare(`INSERT INTO samples (
        model, display_name, effort, measured_at, duration_ms,
        output_tokens, reasoning_output_tokens, tpm
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`) 
      .run(
        sample.model,
        sample.displayName,
        sample.effort,
        sample.measuredAt,
        sample.durationMs,
        sample.outputTokens,
        sample.reasoningOutputTokens,
        sample.tpm,
      );
  }

  list(limit = 2_000) {
    return this.database
      .prepare(`SELECT
        model,
        display_name AS displayName,
        effort,
        measured_at AS measuredAt,
        duration_ms AS durationMs,
        output_tokens AS outputTokens,
        reasoning_output_tokens AS reasoningOutputTokens,
        tpm
      FROM samples
      ORDER BY measured_at DESC
      LIMIT ?`)
      .all(limit);
  }

  close() {
    if (this.database.isOpen) this.database.close();
  }
}

