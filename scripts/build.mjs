import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir(new URL('../plugin/dist/', import.meta.url), { recursive: true });
await build({
  entryPoints: ['src/server.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: new URL('../plugin/dist/server.js', import.meta.url).pathname,
});
await copyFile(
  new URL('../src/panel.html', import.meta.url),
  new URL('../plugin/dist/panel.html', import.meta.url),
);

