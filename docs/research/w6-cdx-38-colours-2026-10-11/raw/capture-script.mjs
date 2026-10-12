// W6-CDX-38 captures: dark theme, 1280x860 and 390x844, through headless Chrome over CDP.
// Usage: node capture.mjs <outDir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
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
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const login = await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ username: 'admin', password: adminPassword() }) })).json();
const token = login.token;
const port = 9438;
const profile = profileDir('capture');
const chrome = spawn(BIN, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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
await send('Network.setCookie', { name: 'sessionToken', value: token, url: BASE + '/' });
await send('Page.enable');
// Dismiss the first-run welcome on the server, so it does not cover every capture.
await fetch(BASE + '/api/first-run/complete', { method: 'POST', headers: { Cookie: 'sessionToken=' + token, Origin: BASE, 'Content-Type': 'application/json' }, body: '{}' });
const routes = [
  ['home', '/'],
  ['archive', '/archives/1'],
  ['document', '/archives/1/doc/1'],
  ['account', '/account'],
  ['admin', '/admin'],
];
const sizes = [[1280, 860], [390, 844]];
const problems = [];
for (const [name, route] of routes) {
  for (const [w, h] of sizes) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await send('Page.navigate', { url: BASE + route });
    await sleep(3500);
    const url = await evalJs('location.pathname');
    if (url !== route) problems.push(`${name} ${w}: landed on ${url}`);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, `${name}-dark-${w}x${h}.png`);
    writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    console.log('wrote', file, 'landed', url);
  }
}
console.log('problems:', problems.length ? problems : 'none');
ws.close(); chrome.kill('SIGTERM');
