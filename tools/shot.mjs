// Dev helper: screenshot panel views at 1920x1080 with the local Chrome, over the DevTools
// protocol (no Playwright download). Usage:
//   node tools/shot.mjs http://localhost:8787 lobby watch request music showtime
// Writes shots/<view>.png.

import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base = 'http://localhost:8787', ...views] = process.argv.slice(2);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = await mkdtemp(join(tmpdir(), 'tp-shot-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waiting = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); waiting.delete(m.id); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await mkdir('shots', { recursive: true });
for (const v of views.length ? views : ['lobby']) {
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url: `${base}/#/${v}` });
  await sleep(Number(process.env.WAIT || 4000));
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`shots/${v}.png`, Buffer.from(r.result.data, 'base64'));
  console.log(`shots/${v}.png`);
}
ws.close();
chrome.kill();
