// W6-CDX-42 captures: Account, Notification preferences, Admin (each tab), not found and first run, dark theme,
// through headless Chrome over CDP. Each PNG is written beside a small DOM probe (JSON) for the state.
// Usage: node capture.mjs <outDir> <baseUrl> [states...]
// Environment (nothing machine-specific or secret is committed):
//   CDX_USERNAME, CDX_PASSWORD        the seeded admin account (passed at run time, never written here), or
//   CDX_SESSION_TOKEN                 a session minted for it, when password sign-in is refused
//   CDX_FIRSTRUN_USERNAME, CDX_FIRSTRUN_PASSWORD   an account whose first run is open (only for the first-run state)
//   CHROME_BIN                        a headless shell; else the Playwright cache under the home directory
// Sizes: 1280x860 and 390x844. Every PNG is opened and read by the author after capture.
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

const OUT = process.argv[2];
const BASE = process.argv[3];
const ONLY = process.argv.slice(4);
if (!OUT || !BASE) throw new Error('usage: node capture.mjs <outDir> <baseUrl> [states...]');
if (!process.env.CDX_SESSION_TOKEN && (!process.env.CDX_USERNAME || !process.env.CDX_PASSWORD)) throw new Error('set CDX_USERNAME and CDX_PASSWORD, or CDX_SESSION_TOKEN');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loginToken(username, password) {
  const res = await (await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username, password }),
  })).json();
  if (!res.token) throw new Error(`login returned no token for ${username}`);
  return res.token;
}

// A pre-minted session (CDX_SESSION_TOKEN) is used when the account cannot sign in by password (suite mode, issuer-linked).
const token = process.env.CDX_SESSION_TOKEN || await loginToken(process.env.CDX_USERNAME, process.env.CDX_PASSWORD);
// The seeded admin has seen its first run; the first-run state uses its own account, and only that one is reset.
await fetch(BASE + '/api/first-run/complete', {
  method: 'POST',
  headers: { Cookie: 'sessionToken=' + token, Origin: BASE, 'Content-Type': 'application/json' },
  body: '{}',
});
const firstRunUser = process.env.CDX_FIRSTRUN_USERNAME
  ? await loginToken(process.env.CDX_FIRSTRUN_USERNAME, process.env.CDX_FIRSTRUN_PASSWORD)
  : null;

const port = 9439 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(tmpdir(), 'cdx42-capture-'));
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
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Network.enable');
await send('Page.enable');

async function setSession(value) {
  await send('Network.deleteCookies', { name: 'sessionToken', url: BASE + '/' });
  await send('Network.setCookie', { name: 'sessionToken', value, url: BASE + '/' });
}
const waitFor = async (expression, ms = 6000) => {
  for (let t = 0; t < ms; t += 200) { if (await evalJs(expression)) return true; await sleep(200); }
  return false;
};

const SIZES = [[1280, 860], [390, 844]];
async function open(route, w, h) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await send('Page.navigate', { url: BASE + route });
  await sleep(2500);
}
async function shot(name, w, h) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, `${name}-dark-${w}x${h}.png`);
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('wrote', file);
}
async function probe(name, w, expression) {
  const value = await evalJs(expression);
  writeFileSync(path.join(OUT, `${name}-probe-${w}.json`), JSON.stringify(value, null, 2));
}
const ACCOUNT_PROBE = `(() => ({
  textboxes: document.querySelectorAll('input[type=text],input[type=email],input[type=password]').length,
  radios: document.querySelectorAll('input[type=radio]').length,
  managedBy: [...document.querySelectorAll('.managed-by span')].map(s => s.textContent),
  managedLinks: [...document.querySelectorAll('.managed-by a')].map(a => a.getAttribute('href')),
  submitButtons: [...document.querySelectorAll('button')].filter(b => /update info/i.test(b.textContent)).length,
  density: getComputedStyle(document.documentElement).getPropertyValue('--density-scale').trim(),
  sidebarAttr: document.body.hasAttribute('data-sidebar-default'),
}))()`;
const ADMIN_PROBE = `(() => {
  const page = document.querySelector('.admin-page, .admin-dashboard');
  return {
    tabs: [...document.querySelectorAll('.admin-tabs__tab, .admin-sidebar__item')].map(b => ({ label: b.textContent, current: b.getAttribute('aria-current') ?? b.className })),
    sidebar: !!document.querySelector('.admin-sidebar'),
    pictographs: page ? (page.textContent.match(/\\p{Extended_Pictographic}/gu) || []) : null,
    cellsWithDigits: [...document.querySelectorAll('.admin-cell-actions')].map(c => c.textContent).filter(t => /\\d/.test(t)),
  };
})()`;

// Each state loads fresh, so no state inherits another's panel.
const states = {
  async account(w, h) { await open('/account', w, h); await waitFor(`!!document.querySelector('.settings-panel')`); await sleep(900); await probe('account', w, ACCOUNT_PROBE); await shot('account', w, h); },
  async 'notification-preferences'(w, h) { await open('/notifications/preferences', w, h); await waitFor(`!!document.querySelector('.notification-prefs-page')`); await sleep(600); await shot('notification-preferences', w, h); },
  async 'admin-overview'(w, h) { await open('/admin', w, h); await waitFor(`!!document.querySelector('.admin-page, .admin-dashboard')`); await sleep(1200); await probe('admin-overview', w, ADMIN_PROBE); await shot('admin-overview', w, h); },
  async 'not-found'(w, h) { await open('/no-such-page-cdx42', w, h); await waitFor(`!!document.querySelector('.not-found-page')`); await sleep(600); await shot('not-found', w, h); },
  async 'first-run'(w, h) {
    if (!firstRunUser) return;
    await setSession(firstRunUser);
    await open('/', w, h);
    // The cached current user belongs to the admin session; clear it so the dialog reads the first-run account alone.
    await evalJs(`(() => { localStorage.clear(); sessionStorage.clear(); return true; })()`);
    await open('/', w, h); await waitFor(`!!document.querySelector('.welcome-setup')`, 8000); await sleep(600); await shot('first-run', w, h);
    await setSession(token);
  },
};
for (const tab of ['users', 'workspaces', 'squads', 'invitations', 'webhooks']) {
  states[`admin-${tab}`] = async (w, h) => {
    await open('/admin', w, h); await waitFor(`!!document.querySelector('.admin-page, .admin-dashboard')`);
    await evalJs(`[...document.querySelectorAll('.admin-tabs__tab, .admin-sidebar__item')].find(b => b.textContent.includes(${JSON.stringify(tab[0].toUpperCase() + tab.slice(1))})).click()`);
    await sleep(1200);
    await probe(`admin-${tab}`, w, ADMIN_PROBE);
    await shot(`admin-${tab}`, w, h);
  };
}

await setSession(token);
// first-run runs last: its account's cached name would otherwise stay in the footer of the states after it.
const names = (ONLY.length ? ONLY : Object.keys(states)).filter((n) => n !== 'first-run').concat(ONLY.length && !ONLY.includes('first-run') ? [] : ['first-run']);
for (const name of names) {
  if (!states[name]) throw new Error(`unknown state ${name}`);
  for (const [w, h] of SIZES) {
    if (name === 'first-run' && !firstRunUser) continue;
    await setSession(name === 'first-run' ? firstRunUser : token);
    await states[name](w, h);
  }
}
ws.close();
chrome.kill();
console.log('done');
