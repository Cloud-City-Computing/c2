// W6-CDX-40 captures: the sidebar-led shell, dark theme, through headless Chrome over CDP.
// Usage: node capture.mjs <outDir> [states...]
// Environment (nothing machine-specific is committed):
//   CDX_BASE            the throwaway instance, default http://127.0.0.1:43380
//   CDX_USERNAME        the throwaway seeded account (required)
//   CDX_PASSWORD        its password (required; there is no default)
//   CHROME_BIN          a headless shell; else PLAYWRIGHT_BROWSERS_PATH, else Playwright's default cache
// Writes one PNG per state and size, and geometry-<label>.json from the probe state.
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
if (!process.env.CDX_USERNAME) throw new Error('set CDX_USERNAME');
if (!process.env.CDX_PASSWORD) throw new Error('set CDX_PASSWORD');
const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node capture.mjs <outDir> [states...]');
const ONLY = process.argv.slice(3);
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = await (await fetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ username: process.env.CDX_USERNAME, password: process.env.CDX_PASSWORD }),
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
const profile = mkdtempSync(path.join(tmpdir(), 'cdx40-capture-'));
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
const SIZES = [[1280, 860], [390, 844]];
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

// Each state is captured on a fresh load so no state inherits another's panel.
const states = {
  async home(w, h) { await open('/', w, h); await waitFor(`!!document.querySelector('main')`); await sleep(800); await shot('home', w, h); },
  async archive(w, h) { await open('/archives/1', w, h); await sleep(1000); await shot('archive', w, h); },
  async document(w, h) {
    if (w < 600) return; // the editor route redirects phones to the archive view, so the document is desktop only
    await open('/editor/1', w, h); await waitFor(`!!document.querySelector('.editor-container')`); await sleep(1500);
    await shot('document', w, h);
  },
  async 'archive-view'(w, h) { await open('/archives/1/doc/1', w, h); await sleep(1000); await shot('archive-view', w, h); },
  async account(w, h) { await open('/account', w, h); await sleep(900); await shot('account', w, h); },
  async admin(w, h) { await open('/admin', w, h); await sleep(1200); await shot('admin', w, h); },
  async notifications(w, h) { await open('/notifications', w, h); await sleep(900); await shot('notifications', w, h); },
  // Phone strip, 320 wide, home only (the strip is one screen; the other routes share its layout).
  async 'home-320'(w, h) { if (w !== 1280) return; await open('/', 320, 740); await sleep(800); await shot('home', 320, 740); },
  // The overlays: the suite switcher (inline), the footer menu (non-modal) and the search palette, with a probe of
  // focus, stacking and keyboard reach. The probe result is written beside the shot.
  async 'switcher-open'(w, h) {
    await open('/', w, h); await waitFor(`!!document.querySelector('.cc-suite__toggle')`);
    await evalJs(`document.querySelector('.cc-suite__toggle').click()`); await sleep(500);
    await shot('switcher-open', w, h);
  },
  async 'account-menu-open'(w, h) {
    await open('/', w, h); await waitFor(`!!document.querySelector('.sidebar__name')`);
    await evalJs(`document.querySelector('.sidebar__name').click()`); await sleep(500);
    const probe = await evalJs(`(() => {
      const menu = document.querySelector('.sidebar__menu');
      const r = menu.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { expanded: document.querySelector('.sidebar__name').getAttribute('aria-expanded'), dimmerShown: !!document.querySelector('#modal-dimmer.active, #modal-dimmer:not([style*="none"])') && getComputedStyle(document.querySelector('#modal-dimmer')).display !== 'none', hitInsideMenu: !!hit && menu.contains(hit), items: [...menu.querySelectorAll('[role=menuitem]')].map((e) => e.textContent) };
    })()`);
    writeFileSync(path.join(OUT, `account-menu-open-probe-${w}.json`), JSON.stringify(probe, null, 2));
    await shot('account-menu-open', w, h);
  },
  async 'search-palette'(w, h) {
    await open('/', w, h); await waitFor(`!!document.querySelector('.search-trigger')`);
    await evalJs(`document.querySelector('.search-trigger').click()`); await waitFor(`!!document.querySelector('.palette input')`);
    await evalJs(`(() => { const i = document.querySelector('.palette input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'api'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await waitFor(`document.querySelectorAll('.palette .palette__result').length > 0`, 4000); await sleep(300);
    const probe = await evalJs(`(() => {
      const pal = document.querySelector('.palette'); const r = pal.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { activeIsInput: document.activeElement === document.querySelector('.palette input'), hitInsidePalette: !!hit && pal.contains(hit), results: pal.querySelectorAll('.palette__result').length, groups: [...pal.querySelectorAll('.palette__group-title')].map((e) => e.textContent), sidebarBehind: getComputedStyle(document.querySelector('.sidebar')).zIndex };
    })()`);
    writeFileSync(path.join(OUT, `search-palette-probe-${w}.json`), JSON.stringify(probe, null, 2));
    await shot('search-palette', w, h);
    await evalJs(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`); await sleep(300);
    const closed = await evalJs(`({ open: !!document.querySelector('.palette'), focusOnTrigger: document.activeElement === document.querySelector('.search-trigger') })`);
    writeFileSync(path.join(OUT, `search-palette-closed-${w}.json`), JSON.stringify(closed, null, 2));
  },
  // Suite mode off: the DOM the sidebar renders (no suite names, the product mark, Workspaces present).
  async 'suite-off-dom'(w) {
    if (w < 600) return;
    await open('/', w, 860); await waitFor(`!!document.querySelector('.sidebar')`); await sleep(800);
    const dom = await evalJs(`(() => {
      const sb = document.querySelector('.sidebar');
      return {
        cluster: sb.querySelectorAll('.cc-suite').length,
        productMarkSvg: sb.querySelectorAll('svg.sidebar__mark').length,
        imgInSidebar: sb.querySelectorAll('img').length,
        workspacesLink: [...sb.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/workspaces'),
        suiteNameInSidebar: sb.textContent.includes('EXAMPLE SUITE') || sb.textContent.includes('Example Suite'),
        topbar: document.querySelectorAll('header.topbar').length,
      };
    })()`);
    writeFileSync(path.join(OUT, 'suite-off-dom.json'), JSON.stringify(dom, null, 2));
    console.log('wrote suite-off-dom.json');
  },
  // Geometry probe on the desktop document: boxes of the editor and its toolbar, settled, at 1280.
  async probe(w) {
    if (w < 600) return;
    await open('/editor/1', w, 860); await waitFor(`!!document.querySelector('.editor-container')`); await sleep(2500);
    const geo = await evalJs(`(() => {
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const pick = (s) => document.querySelector(s);
      return {
        viewport: { w: innerWidth, h: innerHeight },
        mainContent: box(pick('.main-content')),
        editorContainer: box(pick('.editor-container')),
        tiptap: box(pick('.tiptap')),
        toolbar: box(pick('.editor-toolbar, .toolbar, [role="toolbar"]')),
        editorChildren: [...(pick('.editor-container')?.children ?? [])].map((c) => ({ cls: c.className, ...box(c) })),
      };
    })()`);
    writeFileSync(path.join(OUT, 'geometry-editor.json'), JSON.stringify(geo, null, 2));
    console.log('wrote geometry-editor.json');
  },
};

for (const [name, fn] of Object.entries(states)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const [w, h] of SIZES) {
    if (name === 'probe') { try { await fn(w, h); } catch (e) { problems.push(`${name} ${w}: ${e.message}`); } break; }
    try { await fn(w, h); } catch (e) { problems.push(`${name} ${w}: ${e.message}`); }
  }
}
console.log('problems:', problems.length ? problems : 'none');
ws.close(); chrome.kill('SIGTERM');
