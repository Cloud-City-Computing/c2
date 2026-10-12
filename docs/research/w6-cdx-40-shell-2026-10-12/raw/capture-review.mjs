// W6-CDX-40 review-round captures: the signed-out landing, the palette over a modal, the phone switcher and the phone
// strip with twelve or more archives. Headless Chrome over CDP, dark theme, as capture.mjs.
// Usage: node capture-review.mjs <outDir> <signed-in|signed-out> [states...]
// Environment (nothing machine-specific is committed):
//   CDX_BASE, CDX_USERNAME, CDX_PASSWORD (required for signed-in), CHROME_BIN or PLAYWRIGHT_BROWSERS_PATH.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
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
  throw new Error('no headless shell found: set CHROME_BIN or PLAYWRIGHT_BROWSERS_PATH');
}
const BASE = process.env.CDX_BASE || 'http://127.0.0.1:43380';
const OUT = process.argv[2];
const MODE = process.argv[3];
const ONLY = process.argv.slice(4);
if (!OUT || !['signed-in', 'signed-out'].includes(MODE)) throw new Error('usage: node capture-review.mjs <outDir> <signed-in|signed-out> [states...]');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let token = null;
if (MODE === 'signed-in') {
  if (!process.env.CDX_USERNAME || !process.env.CDX_PASSWORD) throw new Error('set CDX_USERNAME and CDX_PASSWORD');
  const login = await (await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username: process.env.CDX_USERNAME, password: process.env.CDX_PASSWORD }),
  })).json();
  token = login.token;
  if (!token) throw new Error('login returned no token');
  await fetch(BASE + '/api/first-run/complete', { method: 'POST', headers: { Cookie: 'sessionToken=' + token, Origin: BASE, 'Content-Type': 'application/json' }, body: '{}' });
}

const port = 9439 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(tmpdir(), 'cdx40-review-'));
const chrome = spawn(chromeBin(), ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 80; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch { /* not up yet */ }
  await sleep(200);
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Network.enable');
if (token) await send('Network.setCookie', { name: 'sessionToken', value: token, url: BASE + '/' });
await send('Page.enable');
const waitFor = async (expression, ms = 6000) => { for (let t = 0; t < ms; t += 200) { if (await evalJs(expression)) return true; await sleep(200); } return false; };

const problems = [];
async function open(route, w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await send('Page.navigate', { url: BASE + route });
  await sleep(3000);
}
async function shot(name, w, h) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, `${name}-dark-${w}x${h}.png`);
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('wrote', file);
}
const probeFile = (name, obj) => { writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(obj, null, 2)); console.log('wrote', name + '.json'); };

const states = {
  // The landing after a sign-out, with no cookie: the Sign in control is on it.
  async 'signed-out-landing'(w, h) {
    await open('/?signedOut=1', w, h); await waitFor(`!!document.querySelector('.welcome-message')`); await sleep(500);
    await shot('signed-out-landing', w, h);
    probeFile(`signed-out-landing-probe-${w}`, await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Sign in'); return { signInButton: !!b, sentence: document.querySelector('.signed-out-sentence')?.textContent ?? null }; })()`));
  },
  // The palette cannot open over a modal: Admin's Invite User dialog is open, Ctrl K is pressed.
  async 'palette-over-modal'(w, h) {
    await open('/admin', w, h); await waitFor(`[...document.querySelectorAll('.admin-sidebar__item')].length > 0`);
    await evalJs(`(() => { const b = [...document.querySelectorAll('.admin-sidebar__item')].find((e) => e.textContent.includes('Invitations')); b && b.click(); return !!b; })()`);
    await sleep(900);
    await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent.includes('Invite User')); b && b.click(); return !!b; })()`);
    await waitFor(`!!document.querySelector('.modal-content-wrapper[role="dialog"]')`); await sleep(500);
    await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`); await sleep(500);
    probeFile(`palette-over-modal-probe-${w}`, await evalJs(`(() => ({ modalOpen: !!document.querySelector('.modal-content-wrapper[role="dialog"]'), paletteOpen: !!document.querySelector('.palette'), rootInert: document.getElementById('root')?.hasAttribute('inert') ?? null }))()`));
    await shot('palette-over-modal', w, h);
  },
  // The phone switcher: row one keeps its three cells, and the panel hangs over the navigation.
  async 'switcher-open-phone'(w, h) {
    if (w >= 600) return;
    await open('/', w, h); await waitFor(`!!document.querySelector('.cc-suite__toggle')`);
    const before = await evalJs(`(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect(); return { workspace: r('.workspace-slot')?.height, search: r('.search-trigger')?.height }; })()`);
    await evalJs(`document.querySelector('.cc-suite__toggle').click()`); await sleep(500);
    probeFile('switcher-open-phone-probe', { before, after: await evalJs(`(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect(); const p = r('.cc-suite__panel'); const row1 = r('.workspace-slot'); return { panelTop: p?.top, panelHeight: p?.height, workspaceHeight: row1?.height, search: r('.search-trigger')?.height, navTop: r('.sidebar__nav')?.top }; })()`) });
    await shot('switcher-open-phone', w, h);
  },
  // The phone strip with fourteen archives: the group shows one item, every other archive is hidden.
  async 'strip-archives-phone'(w, h) {
    if (w >= 600) return;
    await open('/', w, h); await waitFor(`document.querySelectorAll('.sidebar__group li').length >= 12`); await sleep(500);
    probeFile('strip-archives-phone-probe', await evalJs(`(() => { const items = [...document.querySelectorAll('.sidebar__group li')]; return { archiveItems: items.length, hidden: items.filter((li) => getComputedStyle(li).display === 'none').length, visibleFirst: getComputedStyle(items[0]).display, nav: { scrollWidth: document.querySelector('.sidebar__nav').scrollWidth, clientWidth: document.querySelector('.sidebar__nav').clientWidth } }; })()`));
    await shot('strip-archives-phone', w, h);
  },
};

for (const [name, fn] of Object.entries(states)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  if (name.endsWith('-landing') && MODE !== 'signed-out') continue;
  if (!name.endsWith('-landing') && MODE !== 'signed-in') continue;
  for (const [w, h] of [[1280, 860], [390, 844]]) {
    try { await fn(w, h); } catch (e) { problems.push(`${name} ${w}: ${e.message}`); }
  }
}
console.log('problems:', problems.length ? problems : 'none');
ws.close(); chrome.kill('SIGTERM');
