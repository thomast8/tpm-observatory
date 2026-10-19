import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import packageMetadata from '../package.json' with { type: 'json' };

const serverName = `tpm-observatory-${packageMetadata.version.replaceAll('.', '-')}`;
for (const relativePath of ['../plugin/.mcp.json', '../plugin/mcp.json']) {
  const path = new URL(relativePath, import.meta.url);
  const mcp = JSON.parse(await readFile(path, 'utf8'));
  const [configuration] = Object.values(mcp.mcpServers);
  // Desktop shortcut connections can survive an upgrade; a release identity forces a fresh connection.
  mcp.mcpServers = { [serverName]: configuration };
  await writeFile(path, `${JSON.stringify(mcp, null, 2)}\n`);
}
for (const relativePath of ['../plugin/.codex-plugin/plugin.json', '../plugin/plugin.json']) {
  const path = new URL(relativePath, import.meta.url);
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.version = packageMetadata.version;
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
await mkdir(new URL('../plugin/dist/', import.meta.url), { recursive: true });
const serverBuild = await build({
  entryPoints: ['src/server.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  metafile: true,
  outfile: new URL('../plugin/dist/server.js', import.meta.url).pathname,
});
const collectorBuild = await build({
  entryPoints: ['src/collector.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  metafile: true,
  outfile: new URL('../plugin/dist/collector.js', import.meta.url).pathname,
});
await copyFile(
  new URL('../src/panel.html', import.meta.url),
  new URL('../plugin/dist/panel.html', import.meta.url),
);
await copyFile(new URL('../LICENSE', import.meta.url), new URL('../plugin/LICENSE', import.meta.url));
await writeThirdPartyNotices([serverBuild.metafile, collectorBuild.metafile]);

async function writeThirdPartyNotices(metafiles) {
  const packages = new Set();
  for (const input of metafiles.flatMap((metafile) => Object.keys(metafile.inputs))) {
    const match = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (match) packages.add(match[1]);
  }
  const notices = ['Third-party software notices', ''];
  for (const name of [...packages].toSorted()) {
    const root = new URL(`../node_modules/${name}/`, import.meta.url);
    const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
    const licenseFile = (await readdir(root)).find((file) => /^licen[cs]e(?:\.|$)/i.test(file));
    if (!licenseFile) throw new Error(`Missing license file for ${name}`);
    notices.push(`${name} ${metadata.version} (${metadata.license ?? 'see license text'})`, '-'.repeat(72));
    notices.push((await readFile(new URL(licenseFile, root), 'utf8')).trim(), '');
  }
  await writeFile(new URL('../plugin/THIRD_PARTY_NOTICES.txt', import.meta.url), `${notices.join('\n')}\n`);
}

