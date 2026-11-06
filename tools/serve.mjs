#!/usr/bin/env node
// Local-only static server for the webport lab.
//
//   node tools/serve.mjs            -> http://127.0.0.1:4173/
//   node tools/serve.mjs --port 8080
//
// Deliberately boring: no proxy, no outbound requests, no directory listing,
// no execution. COOP/COEP are on so SharedArrayBuffer and worker-based
// streaming stay available later. This is a clean-room rewrite of the pattern
// used by the cyberpunk2077.lol sandbox server; no code from that mirror is
// imported or run.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".unityweb": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

function resolve(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const clean = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(PUBLIC, clean);
  if (abs !== PUBLIC && !abs.startsWith(PUBLIC + path.sep)) return null;
  return abs;
}

function send(req, res, file) {
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (st.isDirectory()) {
    const index = path.join(file, "index.html");
    try { st = fs.statSync(index); } catch { return false; }
    return send(req, res, index);
  }
  if (!st.isFile()) return false;

  const ext = path.extname(file).toLowerCase();
  let type = MIME[ext] || "application/octet-stream";
  let encoding = null;

  // Unity WebGL emits .gz payloads and expects the server to declare the
  // encoding while advertising the underlying MIME type.
  if (ext === ".gz" || ext === ".br") {
    encoding = ext === ".gz" ? "gzip" : "br";
    const inner = path.extname(file.slice(0, -ext.length)).toLowerCase();
    type = MIME[inner] || "application/octet-stream";
  }

  const range = req.headers.range;
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("cache-control", "no-cache");
  if (encoding) {
    res.setHeader("content-encoding", encoding);
    res.setHeader("vary", "Accept-Encoding");
  }

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : st.size - 1;
      if (start <= end && end < st.size) {
        res.writeHead(206, {
          "content-type": type,
          "content-range": `bytes ${start}-${end}/${st.size}`,
          "content-length": end - start + 1,
        });
        if (req.method === "HEAD") return res.end(), true;
        fs.createReadStream(file, { start, end }).pipe(res);
        return true;
      }
    }
  }

  res.writeHead(200, { "content-type": type, "content-length": st.size });
  if (req.method === "HEAD") { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

// The WebGL data blob is committed as three sub-100 MB parts (GitHub rejects
// the single ~193 MB file). Serve a virtual concatenated file with byte-range
// support so Unity can stream it without the image having to unzip anything.
const DATA_URL = "/unity-game/Build/WebGLMenu.data.unityweb";
const PART_DIR = path.join(ROOT, "v12");
const PART_FILES = ["part1.bin", "part2.bin", "part3.bin"].map(name => {
  const file = path.join(PART_DIR, name);
  return { file, size: fs.statSync(file).size };
});
const DATA_SIZE = PART_FILES.reduce((sum, part) => sum + part.size, 0);

async function pipeRange(res, start, end) {
  let base = 0;
  for (const part of PART_FILES) {
    const partEnd = base + part.size - 1;
    if (end >= base && start <= partEnd) {
      const localStart = Math.max(start, base) - base;
      const localEnd = Math.min(end, partEnd) - base;
      const stream = fs.createReadStream(part.file, { start: localStart, end: localEnd });
      for await (const chunk of stream) {
        if (!res.write(chunk)) await new Promise(resolve => res.once("drain", resolve));
      }
    }
    base = partEnd + 1;
  }
  res.end();
}

function sendData(req, res) {
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("content-type", "application/octet-stream");

  let start = 0;
  let end = DATA_SIZE - 1;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      start = match[1] ? Number(match[1]) : 0;
      end = match[2] ? Number(match[2]) : DATA_SIZE - 1;
    }
  }
  if (start < 0 || end >= DATA_SIZE || start > end) {
    res.writeHead(416, { "content-range": `bytes */${DATA_SIZE}` }).end();
    return;
  }

  const partial = Boolean(range);
  const headers = {
    "content-length": end - start + 1,
  };
  if (partial) headers["content-range"] = `bytes ${start}-${end}/${DATA_SIZE}`;
  res.writeHead(partial ? 206 : 200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  pipeRange(res, start, end).catch(() => {
    if (!res.writableEnded) res.destroy();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("cross-origin-embedder-policy", "require-corp");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; " +
    "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; " +
    "base-uri 'none'; frame-ancestors 'none'",
  );

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain" }).end("method not allowed");
    return;
  }

  const url = (req.url || "/").split("?")[0];

  // Unity's default WebGL template uses an inline bootstrap script and
  // WebAssembly compilation; allow those only on the local /unity/ build.
  if (url.startsWith("/unity")) {
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; " +
      "font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; " +
      "base-uri 'none'; frame-ancestors 'none'",
    );
  }

  if (url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, root: "public", offline: true }));
    return;
  }

  if (url === DATA_URL && (req.method === "GET" || req.method === "HEAD")) {
    sendData(req, res);
    return;
  }

  const file = resolve(url === "/" ? "/index.html" : url);
  if (file && send(req, res, file)) return;

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("404 Not Found");
});

server.listen(PORT, HOST, () => {
  console.log(`valheim webport lab`);
  console.log(`  http://${HOST}:${PORT}/`);
  console.log(`  serving ${PUBLIC}`);
  console.log(`  mode: local only, no proxy, no network calls from this server`);
});
