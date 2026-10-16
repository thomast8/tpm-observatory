import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export class CodexTransport {
  constructor(child, timeoutMs = 20_000) {
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.closed = false;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.consume(chunk));
    child.stderr.resume();
    child.stdin.on('error', (error) => this.fail(error));
    child.on('error', (error) => this.fail(error));
    child.on('exit', (code, signal) => {
      if (!this.closed) this.fail(new Error(`Codex app-server exited (${code ?? signal})`));
    });
  }

  static async launch(cwd) {
    const executable = process.env.CODEX_EXECUTABLE || 'codex';
    const child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const transport = new CodexTransport(child);
    try {
      await transport.request('initialize', {
        clientInfo: { name: 'tpm-observatory', title: 'TPM Observatory', version: '0.2.2' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      transport.notify('initialized');
      return transport;
    } catch (error) {
      transport.close();
      throw error;
    }
  }

  request(method, params, timeoutMs = this.timeoutMs) {
    if (this.closed) return Promise.reject(new Error('Codex app-server is closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.write(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params });
  }

  onNotification(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(new Error('Codex app-server was closed'));
    this.child.kill();
  }

  consume(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 1_048_576 && !this.buffer.includes('\n')) {
      this.fail(new Error('Codex app-server sent an oversized message'));
      return;
    }
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        try {
          this.receive(JSON.parse(line));
        } catch {
          this.fail(new Error('Codex app-server sent malformed JSON'));
          return;
        }
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  receive(message) {
    if (message.method && message.id !== undefined) {
      this.write({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32000, message: 'TPM Observatory does not accept server requests' },
      });
      return;
    }
    if (message.method) {
      for (const listener of this.listeners) listener(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  write(message) {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(error);
    for (const listener of this.listeners) listener({ method: 'transport/error', params: { error } });
    this.listeners.clear();
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
export async function discoverModels(dataDir) {
  const transport = await CodexTransport.launch(resolve(dataDir));
  try {
    return await listModels(transport);
  } finally {
    transport.close();
  }
}

async function listModels(transport) {
  const models = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const response = await transport.request('model/list', { cursor, includeHidden: false });
    if (!Array.isArray(response.data)) throw new Error('Codex returned an invalid model catalogue');
    models.push(...response.data.filter((model) => !model.hidden));
    if (response.nextCursor === null) return models;
    if (!response.nextCursor || seen.has(response.nextCursor)) {
      throw new Error('Codex returned invalid model-catalogue pagination');
    }
    seen.add(response.nextCursor);
    cursor = response.nextCursor;
  }
  throw new Error('Codex model catalogue exceeded the pagination limit');
}

