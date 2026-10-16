import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SampleStore } from './store.js';
import { parseTurnTelemetry } from './telemetry.js';

const MAX_TURN_BYTES = 64 * 1024 * 1024;

export async function runCollector(action, input, dataDir) {
  const hook = validateInput(input);
  const store = new SampleStore(resolve(dataDir, 'samples.sqlite'));
  try {
    if (action === 'mark') return await markTurn(store, hook);
    if (action === 'collect') return await collectTurn(store, hook);
    throw new Error('Unknown collector action');
  } catch (error) {
    store.setCollectorStatus('error', 'Background collection needs attention.');
    throw error;
  } finally {
    store.close();
  }
}

async function markTurn(store, hook) {
  if (!hook.transcriptPath) return;
  const details = await stat(hook.transcriptPath);
  if (!details.isFile()) throw new Error('Hook transcript is not a file');
  store.markTurn({ ...hook, startOffset: details.size, createdAt: new Date().toISOString() });
}

async function collectTurn(store, hook) {
  if (!hook.transcriptPath) {
    store.setCollectorStatus('waiting', 'Waiting for a local transcript from Codex.');
    return null;
  }
  const marked = store.getTurn(hook.sessionId, hook.turnId);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const text = await readTurnChunk(hook.transcriptPath, marked?.startOffset);
    const sample = parseTurnTelemetry(text, hook);
    if (sample) {
      store.add(sample);
      store.setCollectorStatus('active', 'Collecting completed Codex turns automatically.', sample.measuredAt);
      return sample;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
  }
  store.setCollectorStatus('waiting', 'Waiting for final telemetry from the latest turn.');
  return null;
}

async function readTurnChunk(path, requestedOffset) {
  const details = await stat(path);
  if (!details.isFile()) throw new Error('Hook transcript is not a file');
  // shortcut: read at most one large turn from an unmarked session, raise the cap if real turns exceed it.
  const fallback = Math.max(0, details.size - MAX_TURN_BYTES);
  const start = requestedOffset !== undefined && requestedOffset <= details.size ? requestedOffset : fallback;
  const length = details.size - start;
  if (length > MAX_TURN_BYTES) throw new Error('Turn telemetry exceeds the 64 MiB safety limit');
  const buffer = Buffer.alloc(length);
  const file = await open(path, 'r');
  try {
    await file.read(buffer, 0, length, start);
  } finally {
    await file.close();
  }
  return buffer.toString('utf8');
}

function validateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Hook input is unavailable');
  const sessionId = requiredString(input.session_id, 'session id', 256);
  const turnId = requiredString(input.turn_id, 'turn id', 256);
  const model = requiredString(input.model, 'model', 256);
  const transcriptPath =
    input.transcript_path === null
      ? null
      : requiredString(input.transcript_path, 'transcript path', 4_096);
  return { sessionId, turnId, model, transcriptPath };
}

function requiredString(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Hook ${label} is unavailable`);
  }
  return value;
}

async function main() {
  const input = await readStdin();
  const action = process.argv[2];
  const dataDir = process.env.PLUGIN_DATA || resolve('.data');
  await runCollector(action, JSON.parse(input), dataDir);
  if (action === 'collect') process.stdout.write('{}');
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 65_536) throw new Error('Hook input is too large');
  }
  return input;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    if (process.argv[2] === 'collect') process.stdout.write('{}');
    process.exitCode = 1;
  });
}

