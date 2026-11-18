import fs from 'node:fs';
import path from 'node:path';
import { createNativeMediaHandler } from './native-media.mjs';

// Separate version routes never alter the original v74 /unity-game/ data path.
export function createVersionedPlayerHandler(root) {
  const directory = path.join(root, 'versions');
  const versions = new Map();
  if (fs.existsSync(directory)) for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^v[1-9][0-9]*$/.test(entry.name)) continue;
    const base = path.join(directory, entry.name), dataBase = path.join(base, 'player'), file = path.join(dataBase, 'data-manifest.json');
    if (!fs.existsSync(file)) continue;
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.version !== entry.name || !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
        !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || !Array.isArray(manifest.parts) || !manifest.parts.length)
      throw new Error('Invalid versioned player data manifest');
    let offset = 0;
    const parts = manifest.parts.map(part => {
      if (!/^data\/part[0-9]{4,}\.bin$/.test(part.path) || !Number.isSafeInteger(part.bytes) || part.bytes <= 0 ||
          part.bytes >= 100000000 || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error('Invalid versioned data part');
      const physical = path.resolve(dataBase, part.path);
      if (!physical.startsWith(dataBase + path.sep) || !fs.statSync(physical).isFile() || fs.statSync(physical).size !== part.bytes)
        throw new Error('Missing versioned data part');
      const result = { file: physical, start: offset, end: offset + part.bytes - 1 }; offset += part.bytes; return result;
    });
    if (offset !== manifest.bytes || new Set(manifest.parts.map(p => p.path)).size !== parts.length)
      throw new Error('Versioned data length/part collision');
    const prefix = `/unity-game/${entry.name}/`;
    const localMediaRoot = path.join(base, 'media');
    const localMediaManifest = path.join(localMediaRoot, 'media-manifest.json');
    const localMedia = fs.existsSync(localMediaManifest) ? createNativeMediaHandler(localMediaManifest, localMediaRoot, prefix) : null;
    const externalMediaRoot = process.env.NATIVE_MEDIA_ROOT ? path.resolve(process.env.NATIVE_MEDIA_ROOT) : null;
    const externalMediaManifest = externalMediaRoot ? path.join(externalMediaRoot, 'media-manifest.json') : null;
    const externalMedia = externalMediaManifest && fs.existsSync(externalMediaManifest)
      ? createNativeMediaHandler(externalMediaManifest, externalMediaRoot, prefix) : null;
    const media = (req, res) => Boolean((localMedia && localMedia(req, res)) || (externalMedia && externalMedia(req, res)));
    versions.set(entry.name, { prefix, dataUrl: prefix + 'Build/WebGLMenu.data.unityweb', manifest, parts, media });
  }
  async function pipe(res, version, begin, end) {
    for (const part of version.parts) {
      if (part.end < begin || part.start > end) continue;
      const stream = fs.createReadStream(part.file, { start: Math.max(begin, part.start) - part.start,
        end: Math.min(end, part.end) - part.start, highWaterMark: 64 * 1024 });
      for await (const chunk of stream) {
        if (res.destroyed) { stream.destroy(); return; }
        if (!res.write(chunk)) await new Promise((resolve, reject) => {
          const drained = () => { res.off('close', closed); resolve(); };
          const closed = () => { res.off('drain', drained); reject(new Error('Versioned data client disconnected')); };
          res.once('drain', drained); res.once('close', closed);
        });
      }
    }
    res.end();
  }
  return function versionedPlayer(req, res) {
    const raw = (req.url || '/').split('?')[0];
    let decoded; try { decoded = decodeURIComponent(raw).replaceAll('\\', '/'); } catch { return false; }
    const normalized = path.posix.normalize(decoded);
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    const match = /^\/unity-game\/(v[1-9][0-9]*)(?:\/|$)/.exec(key);
    if (!match) return false;
    const version = versions.get(match[1]);
    if (!version) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Test version is not published'); return true; }
    if (key === `/unity-game/${match[1]}`) {
      res.writeHead(308, { location: version.prefix, 'cache-control': 'no-store' }).end(); return true;
    }
    // No raw split parts or manifest can fall through to static movie serving.
    const mediaPrefix = version.prefix + (process.platform === 'win32' ? 'cinematics' : 'Cinematics');
    if (key === mediaPrefix || key.startsWith(mediaPrefix + '/')) {
      if (version.media && version.media(req, res)) return true;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('This cinematic is unavailable in this experimental test'); return true;
    }
    if (key !== (process.platform === 'win32' ? version.dataUrl.toLowerCase() : version.dataUrl)) return false;
    const headers = { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store', etag: '"' + version.manifest.sha256 + '"' };
    let begin = 0, end = version.manifest.bytes - 1, partial = false;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) { res.writeHead(416, { ...headers, 'content-range': `bytes */${version.manifest.bytes}` }).end(); return true; }
      if (!range[1]) { const length = Number(range[2]); begin = Math.max(0, version.manifest.bytes - length); if (length <= 0) begin = version.manifest.bytes; }
      else { begin = Number(range[1]); end = range[2] ? Math.min(end, Number(range[2])) : end; }
      if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin > end || begin >= version.manifest.bytes) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${version.manifest.bytes}` }).end(); return true;
      }
      headers['content-range'] = `bytes ${begin}-${end}/${version.manifest.bytes}`; partial = true;
    }
    headers['content-length'] = end - begin + 1;
    res.writeHead(partial ? 206 : 200, headers);
    if (req.method === 'HEAD') res.end(); else pipe(res, version, begin, end).catch(error => res.destroy(error));
    return true;
  };
}
