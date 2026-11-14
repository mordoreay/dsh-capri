// Static file server + sink for the offline Capri frame renderer.
// Serves the workspace (capri-desktop sources + this tool), accepts PNG frames and a manifest
// from the headless page, and writes them under capri-tools/out/<act>/<frame>.png.
import http from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
const PORT = Number(process.env.CAPRI_RENDER_PORT) || 8791;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (url.pathname === '/raw') {
        const act = url.searchParams.get('act');
        const name = url.searchParams.get('name');
        if (!act || !name) throw new Error('act and name are required');
        if (!/^[a-zA-Z0-9_-]+$/.test(act) || !/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('bad name');
        const dir = path.join(OUT, 'raw', act);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `${name}.rgba`), body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (url.pathname === '/frame') {
        const act = url.searchParams.get('act');
        const name = url.searchParams.get('name');
        if (!act || !name) throw new Error('act and name are required');
        if (!/^[a-zA-Z0-9_-]+$/.test(act) || !/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('bad name');
        const dir = path.join(OUT, act);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `${name}.png`), body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (url.pathname === '/manifest') {
        await mkdir(OUT, { recursive: true });
        await writeFile(path.join(OUT, 'manifest.json'), body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (url.pathname === '/done') {
        await writeFile(path.join(OUT, '_done.json'), body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      if (url.pathname === '/log') {
        process.stdout.write(`[page] ${body.toString('utf8')}\n`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      res.writeHead(404); res.end('not found');
      return;
    }

    const rel = decodeURIComponent(url.pathname);
    const file = path.resolve(ROOT, `.${rel}`);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch (error) {
    const code = error && error.code === 'ENOENT' ? 404 : 500;
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String((error && error.message) || error));
  }
});

export { server, OUT, PORT, ROOT };

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[render] serving ${ROOT} on http://127.0.0.1:${PORT}`);
});
