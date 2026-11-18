import fs from 'node:fs';
import path from 'node:path';

// Mount before the ordinary static route. Only manifest-listed original URLs
// resolve; requests never choose a filesystem path. MP4 bytes are streamed
// across bounded split parts without decompressing or buffering the movie.
export function createNativeMediaHandler(manifestPath, mediaRoot, prefix = '/unity-game/') {
  const base = path.resolve(mediaRoot);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported native media manifest');
  const videos = new Map();
  for (const video of manifest.videos) {
    if (!/^Cinematics\/[a-f0-9]{64}\/[^/]+\.mp4$/.test(video.relativeUrl) ||
        video.relativeUrl.split('/')[1] !== video.sha256 || !Number.isSafeInteger(video.bytes) || video.bytes <= 0)
      throw new Error('Invalid original video identity');
    let offset = 0;
    const parts = video.parts.map(part => {
      const file = path.resolve(base, part.path);
      if (!file.startsWith(base + path.sep) || !Number.isSafeInteger(part.bytes) || part.bytes <= 0 ||
          fs.statSync(file).size !== part.bytes) throw new Error('Missing or invalid native media part');
      const result = { file, start: offset, end: offset + part.bytes - 1 };
      offset += part.bytes;
      return result;
    });
    if (offset !== video.bytes || videos.has(prefix + video.relativeUrl)) throw new Error('Native media length or URL collision');
    videos.set(prefix + video.relativeUrl, { ...video, parts });
  }

  async function pipe(res, video, begin, end) {
    for (const part of video.parts) {
      if (part.end < begin || part.start > end) continue;
      const stream = fs.createReadStream(part.file, {
        start: Math.max(begin, part.start) - part.start,
        end: Math.min(end, part.end) - part.start,
        highWaterMark: 64 * 1024,
      });
      for await (const chunk of stream) {
        if (res.destroyed) { stream.destroy(); return; }
        if (!res.write(chunk)) await new Promise((resolve, reject) => {
          const drained = () => { res.off('close', closed); resolve(); };
          const closed = () => { res.off('drain', drained); reject(new Error('Media client disconnected')); };
          res.once('drain', drained); res.once('close', closed);
        });
      }
    }
    res.end();
  }

  return function nativeMedia(req, res) {
    const pathname = new URL(req.url, 'http://native.invalid').pathname;
    const video = videos.get(pathname);
    if (!video) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end(); return true;
    }
    const etag = '"' + video.sha256 + '"';
    const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=31536000, immutable', etag,
      'cross-origin-resource-policy': 'same-origin' };
    if (!req.headers.range && req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers).end(); return true;
    }
    let begin = 0, end = video.bytes - 1, partial = false;
    const range = req.headers['if-range'] && req.headers['if-range'] !== etag ? null : req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${video.bytes}` }).end(); return true;
      }
      if (!match[1]) {
        const suffix = Number(match[2]);
        begin = Math.max(0, video.bytes - suffix);
        if (suffix <= 0) begin = video.bytes;
      } else {
        begin = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), end) : end;
      }
      if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin > end || begin >= video.bytes) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${video.bytes}` }).end(); return true;
      }
      partial = true;
      headers['content-range'] = `bytes ${begin}-${end}/${video.bytes}`;
    }
    headers['content-length'] = end - begin + 1;
    res.writeHead(partial ? 206 : 200, headers);
    if (req.method === 'HEAD') res.end();
    else pipe(res, video, begin, end).catch(error => res.destroy(error));
    return true;
  };
}
