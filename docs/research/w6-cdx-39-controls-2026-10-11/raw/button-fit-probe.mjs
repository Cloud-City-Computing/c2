// W6-CDX-39: do any .btn labels clip at 320 and 390? Reports each button whose content overflows its box.
// Environment: CDX_BASE, CDX_ADMIN_USERNAME, CDX_ADMIN_PASSWORD (required), CHROME_BIN or PLAYWRIGHT_BROWSERS_PATH.
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

function chromeBin() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()[0];
    if (dir) return path.join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
  }
  throw new Error('no headless shell: set CHROME_BIN or PLAYWRIGHT_BROWSERS_PATH');
}
if (!process.env.CDX_ADMIN_USERNAME || !process.env.CDX_ADMIN_PASSWORD) throw new Error('set CDX_ADMIN_USERNAME and CDX_ADMIN_PASSWORD');
const BASE = process.env.CDX_BASE || 'http://127.0.0.1:43380';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ username: process.env.CDX_ADMIN_USERNAME, password: process.env.CDX_ADMIN_PASSWORD }) })).json();
const port = 9621;
const chrome = spawn(chromeBin(), ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'cdx39-fit-'))}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 80; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch { /* starting */ } await sleep(200); }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Network.enable');
await send('Network.setCookie', { name: 'sessionToken', value: login.token, url: BASE + '/' });
await send('Page.enable');
const routes = ['/', '/archives/1', '/archives/1/doc/1', '/activity', '/notifications', '/account', '/admin'];
const report = [];
for (const [w, h] of [[320, 640], [390, 844]]) {
  for (const route of routes) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: BASE + route });
    await sleep(2500);
    const offenders = await ev(`JSON.stringify([...document.querySelectorAll('.btn')].filter((b) => b.offsetParent !== null).map((b) => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent.trim().slice(0, 40), cls: b.className.slice(0, 60), w: Math.round(r.width), h: Math.round(r.height),
        overflowX: b.scrollWidth > b.clientWidth + 1, overflowY: b.scrollHeight > b.clientHeight + 1 };
    }).filter((o) => o.overflowX || o.overflowY))`);
    const list = JSON.parse(offenders);
    report.push({ width: w, route, buttons: await ev(`document.querySelectorAll('.btn').length`), clipped: list });
  }
}
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill('SIGTERM');
