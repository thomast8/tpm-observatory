import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import packageMetadata from '../package.json' with { type: 'json' };

const mcpPath = new URL('../plugin/.mcp.json', import.meta.url);
const mcp = JSON.parse(await readFile(mcpPath, 'utf8'));
const [configuration] = Object.values(mcp.mcpServers);
// Desktop shortcut connections can survive an upgrade; a release identity forces a fresh connection.
mcp.mcpServers = { [`tpm-observatory-${packageMetadata.version.replaceAll('.', '-')}`]: configuration };
await writeFile(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);
await mkdir(new URL('../plugin/dist/', import.meta.url), { recursive: true });
await build({
  entryPoints: ['src/server.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: new URL('../plugin/dist/server.js', import.meta.url).pathname,
});
await build({
  entryPoints: ['src/collector.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: new URL('../plugin/dist/collector.js', import.meta.url).pathname,
});
await copyFile(
  new URL('../src/panel.html', import.meta.url),
  new URL('../plugin/dist/panel.html', import.meta.url),
);

