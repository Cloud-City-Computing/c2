// W6-CDX-41 captures: the lists, home and the document header, dark theme, through headless Chrome over CDP.
// Usage: node capture.mjs <outDir> [states...]
// Environment (nothing machine-specific or secret is committed):
//   CDX_BASE       the throwaway instance, default http://127.0.0.1:43380
//   CDX_USERNAME   the throwaway seeded account's email (required)
//   CDX_PASSWORD   its password (required; there is no default)
//   CHROME_BIN     a headless shell; else PLAYWRIGHT_BROWSERS_PATH, else Playwright's default cache
// Writes one PNG per state and size, and probe-<label>.json from the geometry state.
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
await fetch(BASE + '/api/first-run/complete', {
  method: 'POST',
  headers: { Cookie: 'sessionToken=' + token, Origin: BASE, 'Content-Type': 'application/json' },
  body: '{}',
});

const port = 9439 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(tmpdir(), 'cdx41-capture-'));
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
await send('Network.setCookie', { name: 'sessionToken', value: token, url: BASE + '/' });
await send('Page.enable');

const waitFor = async (expression, ms = 8000) => {
  for (let t = 0; t < ms; t += 200) { if (await evalJs(expression)) return true; await sleep(200); }
  return false;
};

const problems = [];
// CDX_SIZES overrides the sizes, as WIDTHxHEIGHT pairs separated by commas (the phone states add 320).
const SIZES = (process.env.CDX_SIZES || '1280x860,390x844').split(',').map((z) => z.split('x').map(Number));
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

// Each state is captured on a fresh load so no state inherits another's open menu.
const states = {
  async home(w, h) { await open('/', w, h); await waitFor(`!!document.querySelector('.explore-grid, .explore-empty, .empty-state')`); await sleep(800); await shot('home', w, h); },
  async archives(w, h) { await open('/archives', w, h); await waitFor(`!!document.querySelector('.archive-row')`); await sleep(1200); await shot('archives', w, h); },
  async 'archives-menu'(w, h) {
    await open('/archives', w, h); await waitFor(`!!document.querySelector('.archive-row')`);
    await evalJs(`document.querySelector('.archive-row__actions .menu-trigger').click()`);
    await waitFor(`!!document.querySelector('[role="menu"]')`); await sleep(400);
    await shot('archives-menu', w, h);
  },
  async 'archive-view'(w, h) { await open('/archives/1/doc', w, h); await waitFor(`!!document.querySelector('.page-tree-list, .page-tree-empty')`); await sleep(800); await shot('archive-view', w, h); },
  async document(w, h) { await open('/archives/1/doc/1', w, h); await waitFor(`!!document.querySelector('.editor-header')`); await sleep(1500); await shot('document', w, h); },
  async empty(w, h) { await open('/archives/9', w, h); await waitFor(`!!document.querySelector('.log-tree .empty-state')`); await sleep(800); await shot('empty', w, h); },
  // The long-form and list pages at the phone widths: the shell rows and the page's own boxes, for before and after.
  async 'phone-pages'(w, h) {
    if (w >= 600) return;
    const routes = ['/github', '/account', '/archives', '/archives/1/doc', '/notifications', '/activity'];
    const geo = {};
    for (const route of routes) {
      await open(route, w, h); await sleep(1500);
      const slug = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
      geo[route] = await evalJs(`(() => {
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) }; };
        const shell = document.querySelector('.app-shell');
        return {
          docScrollHeight: document.documentElement.scrollHeight,
          shellRows: shell ? getComputedStyle(shell).gridTemplateRows : null,
          sidebar: box(document.querySelector('.sidebar')),
          main: box(document.querySelector('.main-content')),
          ghPage: box(document.querySelector('.gh-page')),
          ghTextarea: box(document.querySelector('.gh-editor-textarea')),
          lastChild: box(document.querySelector('.main-content')?.lastElementChild),
        };
      })()`);
      await shot(`phone-${slug}`, w, h);
    }
    writeFileSync(path.join(OUT, `phone-geometry-${w}.json`), JSON.stringify(geo, null, 2));
    console.log('wrote phone-geometry', w);
  },
  async notifications(w, h) { await open('/notifications', w, h); await waitFor(`!!document.querySelector('.empty-state, .notifications-page__list')`); await sleep(600); await shot('notifications', w, h); },
  async activity(w, h) { await open('/activity', w, h); await waitFor(`!!document.querySelector('.empty-state, .activity-page__list')`); await sleep(600); await shot('activity', w, h); },
  // The app shell's own rows at the phone width, on home and on the archive placeholder (why main may sit lower).
  async 'layout-probe'(w, h) {
    for (const route of ['/', '/archives/1/doc']) {
      await open(route, w, h); await waitFor(`!!document.querySelector('.main-content .page-header, .main-content .home-log')`); await sleep(800);
      const geo = await evalJs(`(() => {
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) }; };
        const shell = document.querySelector('.app-shell');
        return { scrollY: scrollY, shellStyle: shell && getComputedStyle(shell).gridTemplateRows, shell: box(shell), children: shell ? [...shell.children].map((c) => ({ tag: c.tagName, cls: c.className.toString().slice(0, 60), ...box(c) })) : [] };
      })()`);
      writeFileSync(path.join(OUT, `layout-probe-${route === '/' ? 'home' : 'placeholder'}-${w}.json`), JSON.stringify(geo, null, 2));
    }
    console.log('wrote layout-probe', w);
  },
  // The archive placeholder (no document open) and its page header, at the phone width.
  async 'placeholder-probe'(w, h) {
    await open('/archives/1/doc', w, h); await waitFor(`!!document.querySelector('.page-header h1')`); await sleep(800);
    const geo = await evalJs(`(() => {
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
      const pick = (s) => document.querySelector(s);
      return { sidebar: box(pick('.sidebar')), mainContent: box(pick('.main-content')), pageHeader: box(pick('.page-header')), title: box(pick('.page-header__title')), archiveView: box(pick('.archive-view')), before: [...(pick('.main-content')?.children ?? [])].map((c) => ({ cls: c.className, ...box(c) })) };
    })()`);
    writeFileSync(path.join(OUT, `placeholder-probe-${w}.json`), JSON.stringify(geo, null, 2));
    console.log('wrote placeholder-probe', w);
  },
  // Geometry of the editor, read and edit, before and after: the toolbar buttons and the canvas, settled.
  async probe(w) {
    // The phone geometry (390) is measured too, on the same document route.
    const measure = `(() => {
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
      const tb = document.querySelector('.editor-toolbar');
      const canvas = document.querySelector('.editor-container') || document.querySelector('.document-readonly');
      return {
        viewport: { w: innerWidth, h: innerHeight },
        toolbar: box(tb),
        toolbarButtons: [...(tb?.querySelectorAll('button, a, .export-dropdown') ?? [])].map((b) => ({ cls: b.className, text: b.textContent.trim(), ...box(b) })),
        canvas: box(canvas),
        tiptap: box(document.querySelector('.tiptap')),
        contentColumn: box(document.querySelector('.editor-log')),
        header: box(document.querySelector('.editor-header, .editor-log > :first-child')),
        headerParts: ['.editor-breadcrumb', '.page-header__row', '.page-header__titles', '.page-header__title', '.page-header__meta', '.page-header__actions']
          .map((sel) => ({ sel, ...box(document.querySelector(sel)) })),
        mainContent: box(document.querySelector('.main-content')),
        archiveMain: box(document.querySelector('.archive-view__main')),
        archiveView: box(document.querySelector('.archive-view')),
        scrollHeights: { mainContent: document.querySelector('.main-content')?.scrollHeight, mainContentClient: document.querySelector('.main-content')?.clientHeight },
      };
    })()`;
    await open('/archives/1/doc/1', w, 860); await waitFor(`!!document.querySelector('.editor-toolbar')`); await sleep(2500);
    const read = await evalJs(measure);
    writeFileSync(path.join(OUT, `probe-read-${w}.json`), JSON.stringify(read, null, 2));
    await evalJs(`(() => { const b = document.querySelector('.page-header .btn-primary') || [...document.querySelectorAll('.editor-toolbar button')].find((x) => /Edit/.test(x.textContent)); b?.click(); return true; })()`);
    await waitFor(`!!document.querySelector('.editor-container')`); await sleep(2500);
    const edit = await evalJs(measure);
    writeFileSync(path.join(OUT, `probe-edit-${w}.json`), JSON.stringify(edit, null, 2));
    console.log('wrote probe-read/edit', w);
  },
};

for (const [name, fn] of Object.entries(states)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  for (const [w, h] of SIZES) {
    try { await fn(w, h); } catch (e) { problems.push(`${name} ${w}: ${e.message}`); }
  }
}
console.log('problems:', problems.length ? problems : 'none');
ws.close();
chrome.kill('SIGTERM');
