// Drives the offline render: starts the static server in this process, launches headless Chrome on
// the render page, waits for it to post every drawing, then shuts everything down.
//
// Children are spawned with stdio 'ignore'/'inherit': the sandbox refuses piped stdio (EPERM).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const PORT = Number(process.env.CAPRI_RENDER_PORT) || 8791;
const CHROME = process.env.CAPRI_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TIMEOUT_MS = Number(process.env.CAPRI_RENDER_TIMEOUT) || 300_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.argv.includes('--clean') || !process.argv.includes('--resume')) {
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });

await import('./serve.mjs');
await sleep(300);

const profile = path.join(os.tmpdir(), `capri-render-${process.pid}`);
// SwiftShader avoids a GPU dependency but deadlocks on GL readback here; CAPRI_GL=hw uses the
// machine's real GPU instead.
const gl = process.env.CAPRI_GL || 'swiftshader';
const glFlags = gl === 'hw'
  ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization']
  : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  ...glFlags,
  '--window-size=900,1400',
  `--user-data-dir=${profile}`,
  `http://127.0.0.1:${PORT}/capri-tools/page.html${process.env.CAPRI_ACTS ? `?acts=${encodeURIComponent(process.env.CAPRI_ACTS)}` : ''}`,
], { stdio: 'ignore' });

const doneFile = path.join(OUT, '_done.json');
const started = Date.now();
let result = null;
while (Date.now() - started < TIMEOUT_MS) {
  if (existsSync(doneFile)) {
    result = JSON.parse(readFileSync(doneFile, 'utf8'));
    break;
  }
  await sleep(250);
}

chrome.kill();
await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }

if (!result) {
  console.error('[render] timed out waiting for the page');
  process.exit(1);
}
console.log(`[render] result: ${JSON.stringify(result)}`);
process.exit(result.ok ? 0 : 1);
