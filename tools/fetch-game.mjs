import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const archive = path.join(root, '.game.zip');
const parts = [
  'https://raw.githubusercontent.com/MrSh4d0w18/valheim-webgl-assets/main/v12/part1.bin',
  'https://raw.githubusercontent.com/MrSh4d0w18/valheim-webgl-assets/main/v12/part2.bin',
  'https://raw.githubusercontent.com/MrSh4d0w18/valheim-webgl-assets/main/v12/part3.bin',
];

fs.mkdirSync(publicDir, { recursive: true });
const out = fs.openSync(archive, 'wb');
try {
  for (const url of parts) {
    console.log('[railway-build] downloading', url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeSync(out, buffer);
  }
} finally {
  fs.closeSync(out);
}

console.log('[railway-build] extracting');
const zip = new AdmZip(archive);
zip.extractAllTo(publicDir, true);
fs.rmSync(archive, { force: true });
console.log('[railway-build] ready');
