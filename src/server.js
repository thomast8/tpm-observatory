import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { benchmarkModel, discoverModels } from './codex.js';
import { summarize } from './stats.js';
import { SampleStore } from './store.js';

const PANEL_URI = 'ui://tpm-observatory/panel.html';
const dataDir = resolve(process.env.PLUGIN_DATA || '.data');
const store = new SampleStore(join(dataDir, 'samples.sqlite'));
const panelHtml = await readFile(new URL('./panel.html', import.meta.url), 'utf8');
const server = new McpServer({ name: 'tpm-observatory', version: '0.1.0' });
let cachedCatalogue = null;

server.registerResource(
  'tpm-observatory-panel',
  PANEL_URI,
  {
    title: 'TPM Observatory',
    description: 'Observed Codex model throughput over time.',
    mimeType: 'text/html;profile=mcp-app',
  },
  async () => ({
    contents: [{ uri: PANEL_URI, mimeType: 'text/html;profile=mcp-app', text: panelHtml }],
  }),
);

registerAppTool(
  server,
  'tpm_open',
  {
    title: 'Open TPM Observatory',
    description: 'Open the local model throughput dashboard.',
    inputSchema: {},
    _meta: {
      ui: { resourceUri: PANEL_URI },
      'openai/ui': { entrypoints: [{ type: 'thread' }] },
    },
  },
  async () => dashboardReply('TPM Observatory opened.'),
);

registerAppTool(
  server,
  'tpm_refresh',
  {
    title: 'Refresh TPM Observatory',
    description: 'Refresh the live Codex model catalogue and saved measurements.',
    inputSchema: {},
    _meta: { ui: { visibility: ['app'] } },
  },
  async () => dashboardReply('TPM Observatory refreshed.', true),
);

registerAppTool(
  server,
  'tpm_benchmark',
  {
    title: 'Benchmark Codex model',
    description: 'Run one isolated throughput sample. This consumes normal Codex allowance.',
    inputSchema: { model: z.string().min(1) },
    _meta: { ui: { visibility: ['app'] } },
  },
  async ({ model }) => {
    try {
      const sample = await benchmarkModel(model, dataDir);
      store.add(sample);
      return dashboardReply(`Measured ${sample.displayName} at ${Math.round(sample.tpm)} TPM.`, true);
    } catch (error) {
      const message = safeMessage(error);
      const reply = await dashboardReply(`Benchmark failed: ${message}`, true);
      return { ...reply, isError: true };
    }
  },
);

async function dashboardReply(message, forceCatalogue = false) {
  const dashboard = await buildDashboard(forceCatalogue);
  return { content: [{ type: 'text', text: message }], structuredContent: { dashboard, message } };
}

async function buildDashboard(forceCatalogue) {
  let models = [];
  let catalogueError = null;
  try {
    if (forceCatalogue || !cachedCatalogue || Date.now() - cachedCatalogue.at > 60_000) {
      cachedCatalogue = { at: Date.now(), models: await discoverModels(dataDir) };
    }
    models = cachedCatalogue.models;
  } catch (error) {
    catalogueError = safeMessage(error);
  }
  const samples = store.list();
  const catalogue = new Map(models.map((model) => [model.model, model]));
  const ids = new Set([...catalogue.keys(), ...samples.map((sample) => sample.model)]);
  const rows = [...ids].map((id) => modelRow(id, catalogue.get(id), samples));
  const measured = rows.filter((row) => row.stats);
  return {
    generatedAt: new Date().toISOString(),
    catalogueError,
    measurement: 'Output tokens, including reasoning output, per completed turn minute.',
    runCount: samples.length,
    bestModel: measured.toSorted((a, b) => b.stats.average - a.stats.average)[0]?.model ?? null,
    models: rows.toSorted((a, b) => Number(b.available) - Number(a.available)),
  };
}

function modelRow(id, model, allSamples) {
  const samples = allSamples.filter((sample) => sample.model === id).toReversed();
  const stats = summarize(samples.map((sample) => sample.tpm));
  return {
    model: id,
    displayName: model?.displayName ?? samples.at(-1)?.displayName ?? id,
    available: Boolean(model),
    effort: model ? preferredEffort(model) : samples.at(-1)?.effort ?? null,
    isDefault: Boolean(model?.isDefault),
    stats,
    latest: samples.at(-1) ?? null,
    samples: samples.slice(-80),
  };
}

function preferredEffort(model) {
  const supported = model.supportedReasoningEfforts?.map((option) => option.reasoningEffort) ?? [];
  return supported.includes('low') ? 'low' : model.defaultReasoningEffort;
}

function safeMessage(error) {
  return (error instanceof Error ? error.message : 'Unknown error').slice(0, 240);
}

process.once('SIGTERM', () => {
  store.close();
  process.exit(0);
});

await server.connect(new StdioServerTransport());

