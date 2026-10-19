import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('publishes a portable plugin from the repository marketplace', async () => {
  const [marketplace, portable, legacy, mcp] = await Promise.all([
    readJson('../.agents/plugins/marketplace.json'),
    readJson('../plugin/plugin.json'),
    readJson('../plugin/.codex-plugin/plugin.json'),
    readJson('../plugin/mcp.json'),
  ]);
  assert.equal(marketplace.name, 'tpm-observatory');
  assert.deepEqual(marketplace.plugins.map((plugin) => plugin.name), ['tpm-observatory']);
  assert.equal(marketplace.plugins[0].source.path, './plugin');
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.equal(portable.name, legacy.name);
  assert.equal(portable.version, legacy.version);
  assert.equal(portable.license, 'MIT');
  assert.equal(portable.repository, 'https://github.com/thomast8/tpm-observatory');
  assert.deepEqual(Object.values(mcp.mcpServers), [{
    type: 'stdio',
    command: 'node',
    args: ['${PLUGIN_ROOT}/dist/server.js'],
    cwd: '${PLUGIN_ROOT}',
  }]);
  await Promise.all([
    access(new URL('../plugin/LICENSE', import.meta.url)),
    access(new URL('../plugin/THIRD_PARTY_NOTICES.txt', import.meta.url)),
  ]);
});
