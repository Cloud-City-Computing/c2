// Capture the W6-CDX-21 visual set over CDP with the headless shell.
// Usage: node capture.mjs <outDir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = process.env.CHROME_BIN; // a Chromium headless shell
if (!BIN) throw new Error('set CHROME_BIN');
const BASE = process.env.BASE ?? 'http://localhost:3921';
const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ username: 'alice', password: 'password' }),
}).then((r) => r.json());
const TOKEN = login.token;

const profile = mkdtempSync(path.join(os.tmpdir(), 'cdx21-shot-'));
const chrome = spawn(BIN, ['--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\S+)/.exec(buf); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('no devtools url')), 10000);
});
const list = await fetch(wsUrl.replace('ws://', 'http://').replace(/\/devtools\/browser\/.*/, '/json/list')).then((r) => r.json());
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');

async function viewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}
async function signedIn(on) {
  await send('Network.clearBrowserCookies');
  if (on) await send('Network.setCookie', { name: 'sessionToken', value: TOKEN, url: BASE, path: '/', secure: true, sameSite: 'Strict' });
}
async function go(url) { await send('Page.navigate', { url: BASE + url }); await wait(2500); await evaluate("(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Get Started'); if (b) b.click(); })()"); await wait(700); }
async function clickText(selector, text) {
  const ok = await evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)} && e.offsetParent !== null); if (!el) return false; el.click(); return true; })()`);
  await wait(1200);
  return ok;
}
async function hover(selector) {
  const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  if (!box) return false;
  await wait(300);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await wait(600);
  return true;
}
async function scrollTo(selector) {
  const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({block:'center'}); return true; })()`);
  await wait(500);
  return ok;
}
async function shot(name) {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(png.result.data, 'base64'));
}
// Computed styles of the elements the change touches, so the PNGs are not the only evidence.
async function probe(selector, props) {
  return evaluate(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; return els.slice(0, 2).map(el => { const cs = getComputedStyle(el); return Object.fromEntries(${JSON.stringify(props)}.map(p => [p, cs.getPropertyValue(p)])); }); })()`);
}
const probes = {};

for (const [label, w, h] of [['desktop', 1280, 800], ['phone', 390, 844]]) {
  await viewport(w, h);
  await signedIn(false);
  await go('/');
  await shot(`home-${label}`);
  probes[`html-${label}`] = await evaluate('document.documentElement.outerHTML.slice(0, 120)');
  probes[`fonts-${label}`] = await evaluate('[...document.fonts].map(f => f.family + " " + f.status)');
  probes[`body-font-${label}`] = await evaluate('getComputedStyle(document.body).fontFamily');
  const opened = await clickText('button', 'Login');
  probes[`login-opened-${label}`] = opened;
  probes[`btn-oauth-${label}`] = await probe('.btn-oauth', ['border-top-style', 'border-top-color', 'background-color', 'color']);
  probes[`oauth-divider-${label}`] = await evaluate(`getComputedStyle(document.querySelector('.oauth-divider'), '::before').backgroundColor`);
  await shot(`login-${label}`);

  await signedIn(true);
  await go('/account');
  probes[`avatar-placeholder-${label}`] = await probe('.avatar-upload__placeholder', ['background-color']);
  await shot(`account-top-${label}`);
  probes[`linked-${label}`] = await scrollTo('.linked-accounts-list');
  probes[`linked-row-${label}`] = await probe('.linked-account-row', ['border-top-style', 'border-top-color', 'background-color']);
  await shot(`account-linked-${label}`);

  await go('/archives');
  probes[`access-opened-${label}`] = await clickText('button', 'Manage Access');
  probes[`access-tab-${label}`] = await probe('.access-tabs button.active', ['border-bottom-style', 'border-bottom-color']);
  await shot(`access-modal-${label}`);
}

await viewport(1280, 800);
await signedIn(true);
await go('/editor/51');
await wait(2000);
probes['drawio-hover'] = await hover('.drawio-block__delete-btn');
probes['drawio-delete'] = await probe('.drawio-block__delete-btn', ['background-color', 'border-top-color', 'color']);
await shot('drawio-delete-hover-desktop');

probes.errors = errors;
writeFileSync(path.join(outDir, 'probes.json'), JSON.stringify(probes, null, 1));
console.log(JSON.stringify(probes, null, 1));
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
