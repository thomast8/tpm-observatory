import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const profile = await mkdtemp(join(tmpdir(), 'tpm-mcp-qa-'));
const installed = join(profile, 'cache', 'tpm-observatory', 'tpm-observatory', metadata.version);
await cp(join(root, 'codex-plugin'), installed, { recursive: true });
const mcp = JSON.parse(await readFile(join(installed, '.mcp.json'), 'utf8'));
const [configuration] = Object.values(mcp.mcpServers);
const transport = new StdioClientTransport({
  command: configuration.command,
  args: configuration.args,
  cwd: resolve(installed, configuration.cwd),
  env: { ...process.env },
  stderr: 'pipe',
});
const client = new Client({ name: 'tpm-observatory-qa', version: '1.0.0' });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const opened = await client.callTool({ name: 'tpm_open', arguments: {} });
  const resources = await client.listResources();
  const panelUri = tools.tools.find((tool) => tool.name === 'tpm_open')?._meta?.ui?.resourceUri;
  const panel = resources.resources.find(
    (resource) => resource.uri === panelUri,
  );
  if (!panel) throw new Error('Panel resource was not registered');
  const resource = await client.readResource({ uri: panel.uri });
  const dashboard = opened.structuredContent?.dashboard;
  if (!dashboard || dashboard.models.length === 0) {
    throw new Error('Live model catalogue was empty');
  }
  console.log(
    JSON.stringify(
      {
        tools: tools.tools.map((tool) => tool.name),
        models: [...new Set(dashboard.models.filter((model) => model.available).map((model) => model.model))],
        runCount: dashboard.runCount,
        measuredSeries: dashboard.models
          .filter((model) => model.stats)
          .map((model) => `${model.model}:${model.tierName}`),
        panelMimeType: resource.contents[0]?.mimeType,
        panelUri,
      },
      null,
      2,
    ),
  );
} finally {
  await transport.close();
}

