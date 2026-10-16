import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { tokensPerMinute } from './stats.js';

const BENCHMARK_PROMPT = `Write a neutral, continuous 250-word description of a fictional coastal town.
Use plain text only. Do not use tools, inspect files, browse, or discuss this benchmark.`;

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
        clientInfo: { name: 'tpm-observatory', title: 'TPM Observatory', version: '0.1.0' },
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
  const workspace = prepareWorkspace(dataDir);
  const transport = await CodexTransport.launch(workspace);
  try {
    return await listModels(transport);
  } finally {
    transport.close();
  }
}

export async function benchmarkModel(requestedModel, dataDir, timeoutMs = 180_000) {
  const workspace = prepareWorkspace(dataDir);
  const transport = await CodexTransport.launch(workspace);
  try {
    const [models, configResult] = await Promise.all([
      listModels(transport),
      transport.request('config/read', { includeLayers: false }),
    ]);
    const model = models.find((candidate) => candidate.model === requestedModel);
    if (!model) throw new Error('That model is no longer in the live Codex catalogue');
    const effort = selectEffort(model);
    const thread = await transport.request(
      'thread/start',
      threadParams(model.model, workspace, disableCapabilities(configResult.config)),
    );
    if (thread.model !== model.model) throw new Error(`Codex selected ${thread.model} instead`);
    const started = performance.now();
    const result = await runBenchmarkTurn(transport, thread.thread.id, model.model, effort, workspace, timeoutMs);
    const durationMs = result.turn.durationMs ?? Math.round(performance.now() - started);
    const usage = result.usage;
    if (result.turn.status !== 'completed') throw new Error(`Benchmark ${result.turn.status}`);
    if (!usage || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens <= 0) {
      throw new Error('Codex did not report output-token usage');
    }
    return {
      model: model.model,
      displayName: model.displayName,
      effort,
      measuredAt: new Date().toISOString(),
      durationMs,
      outputTokens: usage.outputTokens,
      reasoningOutputTokens: usage.reasoningOutputTokens ?? 0,
      tpm: tokensPerMinute(usage.outputTokens, durationMs),
    };
  } finally {
    transport.close();
  }
}

export function selectEffort(model) {
  const supported = model.supportedReasoningEfforts?.map((option) => option.reasoningEffort) ?? [];
  return supported.includes('low') ? 'low' : model.defaultReasoningEffort;
}

export function disableCapabilities(config) {
  const names = (value) => (Array.isArray(value) ? value : Object.keys(value ?? {}));
  return {
    features: { apps: false, multi_agent: false, hooks: false },
    agents: { enabled: false },
    web_search: 'disabled',
    plugins: Object.fromEntries(names(config?.plugins).map((name) => [name, { enabled: false }])),
    apps: {
      ...Object.fromEntries(names(config?.apps).map((name) => [name, { enabled: false }])),
      _default: { enabled: false },
    },
    mcp_servers: Object.fromEntries(
      names(config?.mcp_servers).map((name) => [name, { enabled: false }]),
    ),
  };
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

function prepareWorkspace(dataDir) {
  const workspace = resolve(dataDir, 'benchmark-workspace');
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  return workspace;
}

function threadParams(model, cwd, config) {
  return {
    model,
    allowProviderModelFallback: false,
    cwd,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: true,
    baseInstructions: 'You are a text generator for a throughput benchmark. Never use tools or inspect files.',
    developerInstructions: 'Return only the requested passage.',
    dynamicTools: [],
    selectedCapabilityRoots: [],
    environments: [],
    runtimeWorkspaceRoots: [cwd],
    config,
  };
}

async function runBenchmarkTurn(transport, threadId, model, effort, cwd, timeoutMs) {
  let turnId = null;
  let usage = null;
  let finish;
  let fail;
  const completion = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const timer = setTimeout(() => fail(new Error('Benchmark timed out')), timeoutMs);
  const unsubscribe = transport.onNotification((message) => {
    const params = message.params ?? {};
    if (params.threadId !== threadId) return;
    if (message.method === 'thread/tokenUsage/updated') usage = params.tokenUsage?.total ?? usage;
    if (message.method === 'model/rerouted') fail(new Error(`Codex rerouted to ${params.toModel}`));
    if (message.method === 'turn/started') turnId = params.turn.id;
    if (message.method === 'turn/completed' && (!turnId || params.turn.id === turnId)) {
      finish({ turn: params.turn, usage });
    }
    if (message.method === 'transport/error') fail(new Error('Codex app-server stopped'));
  });
  try {
    const response = await transport.request(
      'turn/start',
      {
        threadId,
        model,
        effort,
        cwd,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        environments: [],
        runtimeWorkspaceRoots: [cwd],
        input: [{ type: 'text', text: BENCHMARK_PROMPT, text_elements: [] }],
      },
      30_000,
    );
    turnId = response.turn.id;
    if (response.turn.status !== 'inProgress') finish({ turn: response.turn, usage });
    return await completion;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

