// Captures for W6-CDX-44 (the theme switch and the suite preference contract).
//
// Every input comes from the environment, never from this file:
//   BASE_URL      the running Cloud Codex origin, e.g. http://localhost:3000
//   CDX_USER      a signed-in local account's name
//   CDX_PASSWORD  that account's password
//   PW_MODULE     the path (or name) of a playwright-core install; optional, defaults to 'playwright-core'
//   CHROME_PATH   a Chromium executable; optional, defaults to Playwright's own
// Output goes to ./shots beside this file, plus results.json.
//
// Run with the environment above set. The script never prints the password.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PW_MODULE || 'playwright-core');

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'shots');
const BASE = process.env.BASE_URL;
if (!BASE || !process.env.CDX_USER || !process.env.CDX_PASSWORD) {
  throw new Error('Set BASE_URL, CDX_USER and CDX_PASSWORD in the environment.');
}
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 860 },
  { name: '390', width: 390, height: 844 },
];
const log = [];
const note = (entry) => log.push(entry);

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});

// One sign-in for the whole run: the login limiter allows a few attempts per window, so every context reuses
// the token. The app answers with the session token; the client stores it in its session cookie (src/util.jsx
// setSessionCookie), and this sets the same cookie. The app accepts a sign-in only from an Origin it allows.
const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ username: process.env.CDX_USER, password: process.env.CDX_PASSWORD }),
});
if (!login.ok) throw new Error(`sign-in returned ${login.status}`);
const { token } = await login.json();

async function newPage(vp, { stored, scheme }) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme });
  if (stored) {
    await context.addInitScript((value) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('cc_suite_theme', value);
        sessionStorage.setItem('seeded', '1');
      }
    }, stored);
  }
  await context.addCookies([{ name: 'sessionToken', value: token, url: BASE, sameSite: 'Strict' }]);
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return { context, page, problems };
}

// The first-run welcome dialog opens over a new account's first page; dismiss it with its own button.
async function dismissFirstRun(page) {
  const getStarted = page.getByRole('button', { name: 'Get Started', exact: true });
  if (await getStarted.isVisible({ timeout: 3000 }).catch(() => false)) {
    await getStarted.click();
    await page.waitForTimeout(300);
  }
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.basename(file);
}

const themeOf = (page) => page.evaluate(() => document.documentElement.dataset.theme);

for (const vp of VIEWPORTS) {
  for (const start of ['light', 'dark']) {
    const { context, page, problems } = await newPage(vp, { stored: start, scheme: start });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await dismissFirstRun(page);
    await page.waitForSelector('.theme-toggle');
    const before = await themeOf(page);
    note({ step: 'home-start', vp: vp.name, stored: start, theme: before });
    await shot(page, `home-${start}-${vp.name}`);
    await page.hover('.theme-toggle');
    await shot(page, `home-${start}-${vp.name}-toggle-hover`);
    await page.click('.theme-toggle');
    await page.waitForTimeout(200);
    const after = await themeOf(page);
    note({ step: 'home-after-toggle', vp: vp.name, theme: after, toggleName: await page.getAttribute('.theme-toggle', 'aria-label') });
    await shot(page, `home-after-toggle-from-${start}-${vp.name}`);
    note({ vp: vp.name, start, problems });
    await context.close();
  }

  // Appearance: Light, Dark, Match system, and the accent picker, all on the account page.
  const { context, page, problems } = await newPage(vp, { stored: 'dark', scheme: 'dark' });
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
  await dismissFirstRun(page);
  await page.waitForSelector('[role="group"][aria-label="Theme"]');
  const group = page.locator('[role="group"][aria-label="Theme"]');
  await group.getByRole('button', { name: 'Light', exact: true }).click();
  await page.waitForTimeout(150);
  note({ step: 'appearance-light', vp: vp.name, theme: await themeOf(page),
    pressed: await group.locator('[aria-pressed="true"]').allTextContents() });
  await shot(page, `appearance-light-${vp.name}`);

  await group.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.waitForTimeout(150);
  note({ step: 'appearance-dark', vp: vp.name, theme: await themeOf(page),
    pressed: await group.locator('[aria-pressed="true"]').allTextContents() });
  await shot(page, `appearance-dark-${vp.name}`);

  await page.emulateMedia({ colorScheme: 'light' });
  await group.getByRole('button', { name: 'Match system' }).click();
  await page.waitForTimeout(150);
  note({ step: 'appearance-system-os-light', vp: vp.name, theme: await themeOf(page),
    pressed: await group.locator('[aria-pressed="true"]').allTextContents() });
  await shot(page, `appearance-system-os-light-${vp.name}`);

  await page.getByRole('button', { name: 'Nova' }).click();
  await page.waitForTimeout(150);
  note({ step: 'accent-nova-on-light', vp: vp.name, theme: await themeOf(page),
    hue: await page.evaluate(() => document.documentElement.style.getPropertyValue('--cx-accent-h')) });
  await shot(page, `appearance-accent-nova-light-${vp.name}`);
  await page.emulateMedia({ colorScheme: 'dark' });
  await group.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.waitForTimeout(150);
  await shot(page, `appearance-accent-nova-dark-${vp.name}`);
  note({ vp: vp.name, problems });
  await context.close();
}

// First paint for a stored-light user whose OS is dark: the main bundle is held, so the frame is what the
// pre-paint script produced before React ran. Throttled a second time at 6x CPU.
for (const throttle of [false, true]) {
  const vp = VIEWPORTS[0];
  const { context, page, problems } = await newPage(vp, { stored: 'light', scheme: 'dark' });
  const cdp = await context.newCDPSession(page);
  if (throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await gate;
    await route.continue();
  });
  // A deferred module delays DOMContentLoaded, so wait for the body to parse instead: the pre-paint script
  // runs in the head before the body exists.
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForSelector('#modal-root', { state: 'attached' });
  const held = await themeOf(page);
  const name = `first-paint-stored-light-dark-os-${throttle ? 'throttled' : 'normal'}`;
  await shot(page, name);
  note({ step: name, theme: held, stored: 'light', os: 'dark', bundleHeld: true, problems });
  release();
  await dismissFirstRun(page);
  await page.waitForSelector('.theme-toggle', { timeout: 60000 });
  note({ step: `${name}-after-boot`, theme: await themeOf(page) });
  await context.close();
}

writeFileSync(path.join(here, 'results.json'), `${JSON.stringify(log, null, 2)}\n`);
await browser.close();
console.log(`captured ${log.length} entries`);
