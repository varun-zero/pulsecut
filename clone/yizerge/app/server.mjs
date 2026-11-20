/* Self-contained static server for the YIZERGE reconstruction.
   Serves app/ on 127.0.0.1:8892 and answers the formerly-native clip://
   media URLs (rewritten to /clip/ in the bundle) with a valid transparent
   PNG so image/video loads no longer throw ERR_UNKNOWN_URL_SCHEME. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8892;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon'
};

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAE/wL/8pQ2GAAAAABJRU5ErkJggg==',
  'base64'
);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const full = path.resolve(ROOT, decoded.replace(/^\/+/, ''));
  return full.startsWith(ROOT) ? full : null;
}

http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/clip/')) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    return res.end(TRANSPARENT_PNG);
  }
  const file = safePath(url === '/' ? '/index.html' : url);
  if (!file) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size
    });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`YIZERGE clone server: http://127.0.0.1:${PORT}/`);
});
