import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const BIN = '/home/kadams/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:33082';
const OUT = '/tmp/cdx25/rev';
const token = (await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin-pass-25' }) })).json()).token;
const port = 9444;
const chrome = spawn(BIN, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=390,844', '--user-data-dir=/tmp/cdx25/rev/profile', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.find(t => t.type === 'page')) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const log = (...a) => console.log(...a);
await send('Network.enable');
await send('Network.setCookie', { name: 'sessionToken', value: token, url: BASE + '/' });
await send('Page.enable');
const viewport = async (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
const shot = async (file) => { await sleep(500); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.result.data, 'base64')); log('wrote', file); };
const realClick = async (selector) => {
  const box = JSON.parse(await ev(`JSON.stringify((()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})())`));
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
};

// 1. 390x844: the bell with twelve notifications, top bar geometry with the long name
await viewport(390, 844);
await send('Page.navigate', { url: BASE + '/' });
await sleep(4000);
log('suite name length:', await ev("document.querySelector('.cc-suite__eyebrow')?.textContent.length"));
log('eyebrow text-overflow:', await ev("getComputedStyle(document.querySelector('.cc-suite__eyebrow')).textOverflow"));
log('right rect 390:', await ev("JSON.stringify(document.querySelector('.topbar__right').getBoundingClientRect())"), 'viewport', await ev('innerWidth'));
log('left rect 390:', await ev("JSON.stringify(document.querySelector('.topbar__left').getBoundingClientRect())"));
await realClick('button[aria-label^="Notifications"]');
await sleep(800);
log('bell dropdown rect:', await ev("JSON.stringify(document.querySelector('.notification-bell__dropdown')?.getBoundingClientRect())"));
log('mobile nav rect:', await ev("JSON.stringify(document.querySelector('.mobile-nav')?.getBoundingClientRect())"));
log('topmost at mobile-nav top band (x=195,y=800):', await ev("(()=>{const e=document.elementFromPoint(195,800);return e? e.className.toString()+' <'+e.tagName+'>' : 'null'})()"));
log('topmost at dropdown bottom band:', await ev("(()=>{const d=document.querySelector('.notification-bell__dropdown').getBoundingClientRect();const e=document.elementFromPoint(d.left+d.width/2, d.bottom-4);return e? e.className.toString()+' <'+e.tagName+'> in dropdown: '+!!e.closest('.notification-bell__dropdown'):'null'})()"));
await shot(OUT + '/bell-open-390x844.png');

// 2. the cluster open with the long name at 390
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(300);
await realClick('.cc-suite__toggle');
await sleep(500);
log('toggle expanded:', await ev("document.querySelector('.cc-suite__toggle').getAttribute('aria-expanded')"), 'accessible name:', await ev("document.querySelector('.cc-suite__toggle').getAttribute('aria-label')"));
await shot(OUT + '/cluster-long-name-390x844.png');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(300);

// 3. a document page at 390 for the heading face, and the desktop collapsed-sidebar hover over an editor overlay
await send('Page.navigate', { url: BASE + '/' });
await sleep(3000);
const docHref = await ev("document.querySelector('a[href*=\"/doc/\"]')?.getAttribute('href')");
log('document href:', docHref);
await send('Page.navigate', { url: BASE + (docHref || '/') });
await sleep(4000);
log('h1 font-family:', await ev("(()=>{const h=document.querySelector('h1');return h?getComputedStyle(h).fontFamily:'no h1'})()"));
log('body font-family:', await ev("getComputedStyle(document.body).fontFamily"));
await shot(OUT + '/document-390x844.png');
log('topmost at the nav icon row (40,815) on the document:', await ev("(()=>{const e=document.elementFromPoint(40,815);return e? (e.closest('.mobile-nav')?'mobile-nav':e.className.toString())+' <'+e.tagName+'>' : 'null'})()"));

await viewport(1280, 800);
await sleep(600);
await send('Page.navigate', { url: BASE + (docHref || '/') });
await sleep(4000);
if (!(await ev("document.querySelector('.app-shell').classList.contains('sidebar-collapsed')"))) await ev("document.querySelector('.sidebar__toggle')?.click()");
log('collapsed:', await ev("document.querySelector('.app-shell').className"));
await sleep(400);
// An editor overlay over the sidebar column, as a comment highlight or a remote cursor paints it.
await ev(`(()=>{const m=document.querySelector('.main-content');const h=document.createElement('div');h.className='comment-highlights';h.setAttribute('data-proxy','editor-overlay');h.style.cssText='position:fixed;top:0;left:0;width:260px;height:700px;background:rgba(255,80,80,0.5);pointer-events:none;';document.body.appendChild(h);return true})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 400 });
await sleep(200);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: 400 });
await sleep(700);
log('sidebar hover applies:', await ev("getComputedStyle(document.querySelector('.sidebar')).position"));
log('topmost at (100,400) with the hover panel open:', await ev("(()=>{const e=document.elementFromPoint(30,400);return e.closest('.sidebar')?'sidebar':(e.dataset.proxy||e.className)})()"));
log('comment-highlights z:', await ev("getComputedStyle(document.querySelector('.comment-highlights')).zIndex"), 'sidebar z:', await ev("getComputedStyle(document.querySelector('.sidebar')).zIndex"));
await shot(OUT + '/sidebar-hover-over-highlight-1280.png');
ws.close(); chrome.kill('SIGTERM');
