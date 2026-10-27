import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import AdmZip from 'adm-zip';

const repo = 'MrSh4d0w18/valheim-webgl-assets';
const release = JSON.parse(fs.readFileSync('release.json', 'utf8'));
const asset = release.asset;
const tag = release.tag;
const url = `https://github.com/${repo}/releases/download/${tag}/${asset}`;
const zipPath = path.join('public', '.game.zip');
const outDir = path.join('public');

await fsp.mkdir(outDir, { recursive: true });
console.log(`[vercel-build] downloading ${tag}/${asset}`);
const response = await fetch(url, { redirect: 'follow' });
if (!response.ok || !response.body) {
  throw new Error(`download failed: ${response.status} ${response.statusText} ${url}`);
}
await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(zipPath));

const zip = new AdmZip(zipPath);
zip.extractAllTo(outDir, true);
await fsp.rm(zipPath, { force: true });

const entry = path.join(outDir, 'unity-game', 'index.html');
if (!fs.existsSync(entry)) {
  throw new Error('release did not contain unity-game/index.html');
}
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>Valheim WebGL</title>' +
  '<meta http-equiv="refresh" content="0;url=/unity-game/">' +
  '<a href="/unity-game/">Open Valheim WebGL</a>'
);
const files = fs.readdirSync(path.join(outDir, 'unity-game'), { recursive: true });
console.log(`[vercel-build] ready: ${files.length} files`);
