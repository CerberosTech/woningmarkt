// Serve dist/ under the GitHub Pages base path /woningmarkt/, like production. No deps.
// Usage: node scripts/serve.mjs [port]   (default 4173) -> http://localhost:4173/woningmarkt/
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const BASE = '/woningmarkt', ROOT = path.resolve('dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };
export function serve(port = 4173) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/' || url === BASE) { res.writeHead(301, { location: BASE + '/' }); return res.end(); }
    let file = url.startsWith(BASE + '/') ? path.join(ROOT, url.slice(BASE.length)) : null;
    if (file && !file.startsWith(ROOT)) file = null;
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!url.endsWith('/')) { res.writeHead(301, { location: url + '/' }); return res.end(); }
      file = path.join(file, 'index.html');
    }
    if (!file || !fs.existsSync(file)) { res.writeHead(404, { 'content-type': TYPES['.html'] }); return res.end(fs.readFileSync(path.join(ROOT, '404.html'))); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}
if (import.meta.url === `file://${process.argv[1]}`) { const port = +process.argv[2] || 4173; await serve(port); console.log(`http://localhost:${port}${BASE}/`); }
