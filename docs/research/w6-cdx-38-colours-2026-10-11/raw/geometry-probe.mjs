// Geometry probe for the document page: editor container, content column and every control's box.
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

// The headless shell: CHROME_BIN if set, else the newest chromium_headless_shell under PLAYWRIGHT_BROWSERS_PATH,
// else under Playwright's default cache. Nothing machine-specific is written here.
function chromeBin() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()[0];
    if (dir) return path.join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
  }
  throw new Error('no headless shell found: set PLAYWRIGHT_BROWSERS_PATH or CHROME_BIN');
}
// The throwaway instance's admin password. Required: there is no default, so none is committed.
function adminPassword() {
  if (!process.env.CDX_ADMIN_PASSWORD) throw new Error('set CDX_ADMIN_PASSWORD to the throwaway admin password');
  return process.env.CDX_ADMIN_PASSWORD;
}
const BASE = process.env.CDX_BASE || 'http://127.0.0.1:43380';
const profileDir = (name) => mkdtempSync(path.join(tmpdir(), `cdx38-${name}-`));

const BIN = chromeBin();
const out = process.argv[2];
const login = await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ username: 'admin', password: adminPassword() }) })).json();
await fetch(BASE + '/api/first-run/complete', { method: 'POST', headers: { Cookie: 'sessionToken=' + login.token, Origin: BASE, 'Content-Type': 'application/json' }, body: '{}' });
const port = 9439;
const chrome = spawn(BIN, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir('geometry')}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 80; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Network.enable');
await send('Network.setCookie', { name: 'sessionToken', value: login.token, url: BASE + '/' });
await send('Page.enable');
const result = {};
for (const [w, h, label] of [[1280, 860, 'w1280'], [390, 844, 'w390']]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await send('Page.navigate', { url: BASE + '/archives/1/doc/1' });
  await sleep(3500);
  result[label] = JSON.parse(await evalJs(`JSON.stringify((() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const sels = ['.editor-container', '.tiptap', '.archive-view', '.tiptap-toolbar', '.editor-header', '.document-readonly', 'main'];
    const out = {};
    for (const s of sels) out[s] = r(document.querySelector(s));
    out.controls = [...document.querySelectorAll('button, input, select, textarea')].slice(0, 60).map((el) => el.tagName + '.' + (el.className || '') + ' ' + JSON.stringify(r(el)));
    return out;
  })())`));
}
writeJson(out);
function writeJson(file) { import('node:fs').then((fs) => fs.writeFileSync(file, JSON.stringify(result, null, 2))); }
await sleep(300);
ws.close(); chrome.kill('SIGTERM');
