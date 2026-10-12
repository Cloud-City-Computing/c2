// Edit-mode geometry of the deferred editor and its toolbar, for the before and after comparison.
// Environment: CDX_BASE, CDX_ADMIN_USERNAME, CDX_ADMIN_PASSWORD (both required), CHROME_BIN or PLAYWRIGHT_BROWSERS_PATH.
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
if (!process.env.CDX_ADMIN_USERNAME) throw new Error('set CDX_ADMIN_USERNAME');
const profileDir = (name) => mkdtempSync(path.join(tmpdir(), `cdx38-${name}-`));

const BIN = chromeBin();
const login = await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ username: process.env.CDX_ADMIN_USERNAME, password: adminPassword() }) })).json();
const port = 9441;
const chrome = spawn(BIN, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir('edit')}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 80; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Network.enable');
await send('Network.setCookie', { name: 'sessionToken', value: login.token, url: BASE + '/' });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: BASE + '/archives/1/doc/1' });
await sleep(3000);
await ev(`[...document.querySelectorAll('button')].find((b) => /^\\s*(✏️\\s*)?Edit\\s*$/.test(b.textContent))?.click()`);
await sleep(2500);
const measure = `JSON.stringify((() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const out = {};
  for (const s of ['.editor-container', '.tiptap', '.tiptap-toolbar', '.editor-toolbar', '.editor-header', '.editor-with-comments', '.editor-title-edit']) { const el = document.querySelector(s); out[s] = el ? r(el) : null; }
  out.toolbarButtons = [...document.querySelectorAll('.tiptap-toolbar button, .editor-toolbar button, .editor-mode-toggle')].slice(0, 30).map((b) => [b.className.slice(0,30), r(b), getComputedStyle(b).fontFamily.slice(0, 24)]);
  out.textareas = [...document.querySelectorAll('textarea')].slice(0, 10).map((t) => [t.className.slice(0,30), r(t), getComputedStyle(t).fontFamily.slice(0, 24)]);
  out.commentButtons = [...document.querySelectorAll('.comment-manager button, .comment-thread button')].slice(0, 10).map((b) => [b.className.slice(0,30), r(b)]);
  return out;
})())`;
const result = JSON.parse(await ev(measure));
console.log(JSON.stringify(result));
await sleep(200);
ws.close(); chrome.kill('SIGTERM');
