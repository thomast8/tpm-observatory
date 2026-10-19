import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('the opener and resource share a release-specific address to avoid stale host HTML', async () => {
  const root = resolve(new URL('..', import.meta.url).pathname);
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const plugin = JSON.parse(await readFile(join(root, 'plugin/.codex-plugin/plugin.json'), 'utf8'));
  const mcp = JSON.parse(await readFile(join(root, 'plugin/.mcp.json'), 'utf8'));
  const portablePlugin = JSON.parse(await readFile(join(root, 'plugin/plugin.json'), 'utf8'));
  const portableMcp = JSON.parse(await readFile(join(root, 'plugin/mcp.json'), 'utf8'));
  assert.equal(plugin.version, metadata.version);
  assert.equal(portablePlugin.version, metadata.version);
  assert.deepEqual(Object.keys(mcp.mcpServers), [
    `tpm-observatory-${metadata.version.replaceAll('.', '-')}`,
  ]);
  assert.deepEqual(Object.keys(portableMcp.mcpServers), Object.keys(mcp.mcpServers));
  assert.equal(portableMcp.mcpServers[Object.keys(portableMcp.mcpServers)[0]].type, 'stdio');
  const dataDir = await mkdtemp(join(tmpdir(), 'tpm-resource-test-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/server.js'],
    cwd: root,
    env: { ...process.env, PLUGIN_DATA: dataDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'resource-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const opener = tools.tools.find((tool) => tool.name === 'tpm_open');
    const uri = `ui://tpm-observatory/panel-${metadata.version}.html`;
    assert.equal(opener._meta.ui.resourceUri, uri);
    const resources = await client.listResources();
    assert.ok(resources.resources.some((resource) => resource.uri === uri));
    assert.ok(resources.resources.every((resource) => resource.uri !== 'ui://tpm-observatory/panel.html'));
    const panel = await client.readResource({ uri });
    assert.equal(panel.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.match(panel.contents[0].text, /A quiet record of how your models move/);
  } finally {
    await transport.close();
  }
});
