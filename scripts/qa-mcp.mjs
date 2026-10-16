import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const dataDir = process.env.TPM_OBSERVATORY_QA_DATA || resolve(root, '.data', 'mcp-qa');
const transport = new StdioClientTransport({
  command: 'node',
  args: ['plugin/dist/server.js'],
  cwd: root,
  env: { ...process.env, PLUGIN_DATA: dataDir },
  stderr: 'pipe',
});
const client = new Client({ name: 'tpm-observatory-qa', version: '0.2.4' });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const opened = await client.callTool({ name: 'tpm_open', arguments: {} });
  const resources = await client.listResources();
  const panel = resources.resources.find(
    (resource) => resource.uri === 'ui://tpm-observatory/panel.html',
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
      },
      null,
      2,
    ),
  );
} finally {
  await transport.close();
}

