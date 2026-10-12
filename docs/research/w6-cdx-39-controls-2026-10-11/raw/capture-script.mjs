// W6-CDX-39 captures: control families and the Toast, dark theme, 1280x860 and 390x844, through headless Chrome over CDP.
// Usage: node capture-script.mjs <outDir>
// Environment (nothing machine-specific is committed):
//   CDX_BASE            the throwaway instance, default http://127.0.0.1:43380
//   CDX_ADMIN_USERNAME  the throwaway admin username (required)
//   CDX_ADMIN_PASSWORD  the throwaway admin password (required; there is no default)
//   CHROME_BIN          a headless shell; else PLAYWRIGHT_BROWSERS_PATH, else Playwright's default cache
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
if (!process.env.CDX_ADMIN_PASSWORD) throw new Error('set CDX_ADMIN_PASSWORD');
const BASE = process.env.CDX_BASE || 'http://127.0.0.1:43380';
if (!process.env.CDX_ADMIN_USERNAME) throw new Error('set CDX_ADMIN_USERNAME');
const USER = process.env.CDX_ADMIN_USERNAME;
if (!USER) throw new Error('set CDX_ADMIN_USERNAME to the throwaway admin username');
const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node capture-script.mjs <outDir>');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await (await fetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ username: USER, password: process.env.CDX_ADMIN_PASSWORD }),
})).json();
const token = login.token;
if (!token) throw new Error('login returned no token');
const api = (method, p, body) => fetch(BASE + p, {
  method,
  headers: { Cookie: 'sessionToken=' + token, Origin: BASE, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
await api('POST', '/api/first-run/complete', {});

const port = 9439 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(tmpdir(), 'cdx39-capture-'));
const chrome = spawn(chromeBin(), ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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
await send('Network.setCookie', { name: 'sessionToken', value: token, url: BASE + '/' });
await send('Page.enable');

const waitFor = async (expression, ms = 6000) => {
  for (let t = 0; t < ms; t += 200) { if (await evalJs(expression)) return true; await sleep(200); }
  return false;
};

const problems = [];
const sizes = [[1280, 860], [390, 844]];
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
async function admin(w, h, tab) {
  await open('/admin', w, h);
  if (tab) {
    await evalJs(`(() => { const b=[...document.querySelectorAll('.admin-sidebar__item')].find(e=>e.textContent.includes(${JSON.stringify(tab)})); b&&b.click(); return !!b; })()`);
    await sleep(1200);
  }
}

// States. Each is captured at both sizes, on a fresh page load so a state never inherits another's dialog.
const states = {
  async 'explore'(w, h) { await open('/', w, h); await waitFor(`!!document.querySelector('.explore-sort, [aria-label="Sort documents"]')`); await shot('explore', w, h); },
  async 'explore-sort-open'(w, h) {
    await open('/', w, h);
    await waitFor(`!!document.querySelector('[aria-label="Sort documents"]')`);
    await evalJs(`(() => { const b=document.querySelector('[aria-label="Sort documents"]'); b&&b.click(); return !!b; })()`);
    await sleep(500); await shot('explore-sort-open', w, h);
  },
  async 'account-fields'(w, h) { await open('/account', w, h); await sleep(800); await shot('account-fields', w, h); },
  async 'buttons-archive'(w, h) { await open('/archives/1', w, h); await sleep(800); await shot('buttons-archive', w, h); },
  async 'activity-tabs'(w, h) { await open('/activity', w, h); await sleep(800); await shot('activity-tabs', w, h); },
  async 'notifications-tabs'(w, h) { await open('/notifications', w, h); await sleep(800); await shot('notifications-tabs', w, h); },
  async 'admin-users-chips'(w, h) { await admin(w, h, 'Users'); await shot('admin-users-chips', w, h); },
  async 'confirm-delete-dialog'(w, h) {
    await admin(w, h, 'Users');
    await evalJs(`(() => { const b=[...document.querySelectorAll('button.btn-danger')].find(e=>e.textContent.trim()==='Delete'); b&&b.click(); return !!b; })()`);
    await sleep(800); await shot('confirm-delete-dialog', w, h);
    // Cancel, so nothing is deleted.
    await evalJs(`(() => { const b=[...document.querySelectorAll('.confirm-dialog button')].find(e=>e.textContent.trim()==='Cancel'); b&&b.click(); return !!b; })()`);
  },
  async 'invite-dialog'(w, h) {
    await admin(w, h, 'Invitations');
    await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Invite User')); b&&b.click(); return !!b; })()`);
    await sleep(900); await shot('invite-dialog', w, h);
  },
  async 'invite-squad-menu'(w, h) {
    await admin(w, h, 'Invitations');
    await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Invite User')); b&&b.click(); return !!b; })()`);
    await sleep(900);
    await evalJs(`(() => { const b=document.querySelector('#invite-squad') || document.querySelector('select#invite-squad'); if (b && b.tagName==='BUTTON') b.click(); return !!b; })()`);
    await sleep(500); await shot('invite-squad-menu', w, h);
  },
  // The first toast after a fresh load: Invite User, then Copy link. The copy either succeeds or is refused by the
  // browser, and both paths raise a toast. Before W6-CDX-39 the first toast after a load was dropped (X2).
  async 'toast-after-copy'(w, h) {
    const email = `toast-check-${w}-${Date.now()}@example.test`;
    await open('/admin', w, h);
    await evalJs(`(() => { const b=[...document.querySelectorAll('.admin-sidebar__item')].find(e=>e.textContent.includes('Invitations')); b&&b.click(); return !!b; })()`);
    await sleep(900);
    await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Invite User')); b&&b.click(); return !!b; })()`);
    await waitFor(`!!document.getElementById('invite-email')`);
    await evalJs(`(() => { const i=document.getElementById('invite-email'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i, ${JSON.stringify(email)}); i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Send Invitation'); b&&b.click(); return !!b; })()`);
    const copied = await waitFor(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Copy link')`);
    if (!copied) { problems.push(`toast ${w}: no Copy link button`); return; }
    await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Copy link'); b&&b.click(); return !!b; })()`);
    await sleep(1500); await shot('toast-after-copy', w, h);
  },
};

for (const [name, fn] of Object.entries(states)) {
  for (const [w, h] of sizes) {
    try { await fn(w, h); } catch (e) { problems.push(`${name} ${w}: ${e.message}`); }
  }
}
console.log('problems:', problems.length ? problems : 'none');
ws.close(); chrome.kill('SIGTERM');
