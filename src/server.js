import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { discoverModels } from './codex.js';
import { summarize } from './stats.js';
import { SampleStore } from './store.js';

const PANEL_URI = 'ui://tpm-observatory/panel.html';
const dataDir = resolve(process.env.PLUGIN_DATA || '.data');
const store = new SampleStore(join(dataDir, 'samples.sqlite'));
const panelHtml = await readFile(new URL('./panel.html', import.meta.url), 'utf8');
const server = new McpServer({ name: 'tpm-observatory', version: '0.3.0' });
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
    description: 'Refresh saved measurements and the cached Codex model catalogue.',
    inputSchema: {},
    _meta: { ui: { visibility: ['app'] } },
  },
  async () => dashboardReply('TPM Observatory refreshed.'),
);

async function dashboardReply(message) {
  const dashboard = await buildDashboard();
  return { content: [{ type: 'text', text: message }], structuredContent: { dashboard, message } };
}

async function buildDashboard() {
  let models = [];
  let catalogueError = null;
  try {
    if (!cachedCatalogue || Date.now() - cachedCatalogue.at > 60_000) {
      cachedCatalogue = { at: Date.now(), models: await discoverModels(dataDir) };
    }
    models = cachedCatalogue.models;
  } catch (error) {
    catalogueError = safeMessage(error);
  }
  const samples = store.list(2_000, 'observed');
  const catalogue = new Map(models.map((model) => [model.model, model]));
  const series = new Set(samples.map((sample) => seriesId(sample.model, sample.serviceTier)));
  for (const model of models) {
    series.add(seriesId(model.model, 'default'));
    for (const tier of model.serviceTiers ?? []) series.add(seriesId(model.model, tier.id));
  }
  const rows = [...series].map((id) => modelRow(id, catalogue, samples));
  const measured = rows.filter((row) => row.stats);
  return {
    generatedAt: new Date().toISOString(),
    catalogueError,
    collector: store.getCollectorStatus() ?? {
      state: 'waiting',
      message: 'Waiting for the next completed Codex turn.',
      lastAttemptAt: null,
      lastSampleAt: null,
    },
    measurement: 'Output tokens, including reasoning output, per active model-generation minute.',
    runCount: samples.length,
    bestSeries: measured.toSorted((a, b) => b.stats.average - a.stats.average)[0]?.seriesId ?? null,
    models: rows.toSorted(compareRows),
  };
}

function modelRow(id, catalogue, allSamples) {
  const [modelId, serviceTier] = id.split('::');
  const model = catalogue.get(modelId);
  const samples = allSamples
    .filter((sample) => sample.model === modelId && sample.serviceTier === serviceTier)
    .toReversed();
  const stats = summarize(samples.map((sample) => sample.tpm));
  return {
    seriesId: id,
    model: modelId,
    serviceTier,
    tierName: tierName(model, serviceTier),
    displayName: model?.displayName ?? samples.at(-1)?.displayName ?? modelId,
    available: Boolean(model),
    isDefault: Boolean(model?.isDefault),
    stats,
    latest: samples.at(-1) ?? null,
    samples: samples.slice(-80),
  };
}

function tierName(model, serviceTier) {
  if (serviceTier === 'default') return 'Standard';
  const catalogName = model?.serviceTiers?.find((tier) => tier.id === serviceTier)?.name;
  if (catalogName) return catalogName;
  if (/ultra.?fast/i.test(serviceTier)) return 'Ultra Fast';
  if (/priority|fast/i.test(serviceTier)) return 'Fast';
  return serviceTier.replaceAll(/[_-]+/g, ' ').replaceAll(/\b\w/g, (letter) => letter.toUpperCase());
}

function seriesId(model, serviceTier) {
  return `${model}::${serviceTier || 'default'}`;
}

function compareRows(left, right) {
  const modelOrder = left.displayName.localeCompare(right.displayName);
  if (modelOrder !== 0) return modelOrder;
  const order = { Standard: 0, Fast: 1, 'Ultra Fast': 2 };
  return (order[left.tierName] ?? 10) - (order[right.tierName] ?? 10);
}

function safeMessage(error) {
  return (error instanceof Error ? error.message : 'Unknown error').slice(0, 240);
}

process.once('SIGTERM', () => {
  store.close();
  process.exit(0);
});

await server.connect(new StdioServerTransport());

