// Captures for W6-CDX-44 (the theme switch and the suite preference contract), Codex side.
//
// Every input comes from the environment, never from this file:
//   BASE_URL      the running Cloud Codex origin, e.g. http://localhost:3000
//   CDX_USER      a signed-in local account's name
//   CDX_PASSWORD  that account's password
//   CDX_ARCHIVE   an archive id the account can read
//   CDX_LOG       a document id in that archive
//   PW_MODULE     the path (or name) of a playwright-core entry module; optional, defaults to 'playwright-core'
//   CHROME_PATH   a Chromium executable; optional, defaults to Playwright's own
// Output goes to ./shots beside this file, plus results.json (no credentials, no machine paths).

import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PW_MODULE || 'playwright-core');

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'shots');
const BASE = process.env.BASE_URL;
const ARCHIVE = process.env.CDX_ARCHIVE;
const LOG = process.env.CDX_LOG;
if (!BASE || !process.env.CDX_USER || !process.env.CDX_PASSWORD || !ARCHIVE || !LOG) {
  throw new Error('Set BASE_URL, CDX_USER, CDX_PASSWORD, CDX_ARCHIVE and CDX_LOG in the environment.');
}
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 860 },
  { name: '390', width: 390, height: 844 },
];
const POPOVER_VIEWPORTS = [...VIEWPORTS, { name: '320', width: 320, height: 640 }];
const THEMES = ['light', 'dark'];
const ROUTES = [
  ['home', '/'],
  ['archives', '/archives'],
  ['archive', `/archives/${ARCHIVE}`],
  ['doc-read', `/archives/${ARCHIVE}/doc/${LOG}`],
  ['doc-edit', `/editor/${LOG}`],
  ['account', '/account'],
  ['admin', '/admin'],
  ['notifications', '/notifications'],
  ['activity', '/activity'],
  ['workspaces', '/workspaces'],
  ['not-found', '/404'],
];

const log = [];
const note = (entry) => {
  log.push(entry);
  writeFileSync(path.join(here, 'results.json'), `${JSON.stringify(log, null, 2)}\n`);
};
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});

// The app answers a sign-in with the session token; the client stores it in its session cookie
// (src/util.jsx setSessionCookie). One sign-in for the whole run: the login limiter is strict.
const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ username: process.env.CDX_USER, password: process.env.CDX_PASSWORD }),
});
if (!login.ok) throw new Error(`sign-in returned ${login.status}`);
const { token } = await login.json();

async function newContext(vp, { stored, scheme, signedIn = true }) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme });
  if (stored) {
    await context.addInitScript((value) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('cc_suite_theme', value);
        sessionStorage.setItem('seeded', '1');
      }
    }, stored);
  }
  if (signedIn) await context.addCookies([{ name: 'sessionToken', value: token, url: BASE, sameSite: 'Strict' }]);
  return context;
}

async function openPage(context) {
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { page, problems };
}

// The first-run welcome dialog opens over a new account's first page; dismiss it with its own button.
async function dismissFirstRun(page) {
  const getStarted = page.getByRole('button', { name: 'Get Started', exact: true });
  if (await getStarted.isVisible({ timeout: 2000 }).catch(() => false)) {
    await getStarted.click();
    await page.waitForTimeout(300);
  }
}

const themeOf = (page) => page.evaluate(() => document.documentElement.dataset.theme);
// The app polls for notifications, so networkidle may never come; wait for load and a short settle.
const settle = async (page) => {
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(700);
};

// --- The routes, both themes, both widths -------------------------------------------------------
for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const context = await newContext(vp, { stored: theme, scheme: theme });
    const { page, problems } = await openPage(context);
    for (const [name, route] of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await dismissFirstRun(page);
      await settle(page);
      note({ shot: `${name}-${theme}-${vp.name}`, route, vp: vp.name, theme: await themeOf(page), url: new URL(page.url()).pathname });
      await page.screenshot({ path: path.join(OUT, `${name}-${theme}-${vp.name}.png`) });
    }
    note({ vp: vp.name, theme, problems });
    await context.close();
  }

  // Signed out: the front door, in each theme (no session cookie).
  for (const theme of THEMES) {
    const context = await newContext(vp, { stored: theme, scheme: theme, signedIn: false });
    const { page, problems } = await openPage(context);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    note({ shot: `signed-out-${theme}-${vp.name}`, route: '/', vp: vp.name, theme: await themeOf(page), problems });
    await page.screenshot({ path: path.join(OUT, `signed-out-${theme}-${vp.name}.png`) });
    await context.close();
  }
}

// --- The Appearance popover: open at each width, both themes, plus keyboard focus ---------------
for (const vp of POPOVER_VIEWPORTS) {
  for (const theme of THEMES) {
    const context = await newContext(vp, { stored: theme, scheme: theme });
    const { page, problems } = await openPage(context);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await dismissFirstRun(page);
    const toggle = page.getByRole('button', { name: 'Appearance', exact: true });
    await toggle.click();
    await page.waitForSelector('.appearance-panel');
    await page.waitForTimeout(200);
    const checked = await page.locator('.appearance-panel [aria-pressed="true"]').first().getAttribute('aria-label');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    note({ shot: `popover-open-${theme}-${vp.name}`, vp: vp.name, theme: await themeOf(page), checkedTheme: checked, focusOnOpen: focused, problems });
    await page.screenshot({ path: path.join(OUT, `popover-open-${theme}-${vp.name}.png`) });
    if (vp.name === '1280') {
      // Keyboard only: focus the toggle with Tab, open it with Enter, then Tab once inside the panel.
      await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
      await page.keyboard.press('Escape');
      await page.waitForSelector('.appearance-panel', { state: 'detached' });
      await toggle.focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('.appearance-panel');
      await page.keyboard.press('Tab');
      const afterTab = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      note({ shot: `keyboard-focus-${theme}-${vp.name}`, vp: vp.name, theme: await themeOf(page), focusAfterTab: afterTab });
      await page.screenshot({ path: path.join(OUT, `keyboard-focus-${theme}-${vp.name}.png`) });
      await page.keyboard.press('Escape');
      note({ step: 'escape', focusAfterEscape: await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) });
    }
    await context.close();
  }
}

// --- First paint: the stored choice must be on the page before React runs ----------------------
// The stylesheet is render-blocking: with it held, Chromium paints nothing at all (a blank frame proves
// nothing), so the stylesheet is let through. Only the React bundle is held. The frame measured is therefore
// the first paint with the CSS applied and no React yet: the html computed background is read from the
// stylesheet's own [data-theme] binding, and the canvas pixel is sampled at (2,2). The control strips the
// inline boot script from the served HTML (same bytes otherwise) and must paint the wrong theme.
function pixelOf(png) {
  let off = 8;
  const idat = [];
  let colorType = 2;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') colorType = data[9];
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  // A 1x1 image: every PNG predictor uses zero neighbours, so the pixel bytes are the raw bytes after the filter byte.
  return [raw[1], raw[2], raw[3]];
}

async function firstPaint({ name, strip, throttle }) {
  const vp = VIEWPORTS[0];
  const context = await newContext(vp, { stored: 'light', scheme: 'dark' });
  const { page, problems } = await openPage(context);
  if (throttle) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  }
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await gate;
    await route.continue();
  });
  if (strip) {
    await page.route((url) => url.pathname === '/', async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(/<script>[\s\S]*?<\/script>/, '');
      await route.fulfill({ response, body });
    });
  }
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForSelector('#modal-root', { state: 'attached' });
  await page.waitForFunction(() => document.styleSheets.length > 0, null, { timeout: 15000 });
  const probe = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
    stylesheetsApplied: document.styleSheets.length,
    reactMounted: document.getElementById('root')?.childElementCount > 0,
  }));
  // The DevTools protocol captures the frame without waiting for fonts, which the held stylesheet keeps pending.
  const shotCdp = await context.newCDPSession(page);
  const { data: pixelData } = await shotCdp.send('Page.captureScreenshot', {
    format: 'png', clip: { x: 2, y: 2, width: 1, height: 1, scale: 1 },
  });
  const [r, g, b] = pixelOf(Buffer.from(pixelData, 'base64'));
  const lightCanvas = r + g + b > 600;
  const { data: frameData } = await shotCdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(frameData, 'base64'));
  note({ step: name, stored: 'light', os: 'dark', throttle, bootScriptRemoved: strip, ...probe, canvasRgb: [r, g, b], lightCanvas, problems });
  release();
  await context.close();
}

await firstPaint({ name: 'first-paint-stored-light-os-dark-normal', strip: false, throttle: false });
await firstPaint({ name: 'first-paint-stored-light-os-dark-throttled', strip: false, throttle: true });
await firstPaint({ name: 'first-paint-control-no-script-stored-light-os-dark', strip: true, throttle: false });

writeFileSync(path.join(here, 'results.json'), `${JSON.stringify(log, null, 2)}\n`);
await browser.close();
console.log(`captured ${log.length} entries`);
