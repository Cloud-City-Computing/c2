// Captures the Codex main pages at 1280x860 and 390x844, in dark and light, from a local instance.
//
// Usage: node capture.mjs <out-dir>
// Environment (none of it is stored here):
//   CAPTURE_PASSWORD  the sign-in password of CAPTURE_USER (the local seed account)
//   CAPTURE_USER      the sign-in name (default alice)
//   CAPTURE_BASE      the suite-off instance, e.g. http://127.0.0.1:3917
//   CAPTURE_SUITE     the suite-on instance, e.g. http://127.0.0.1:3918 (Account only)
//   CHROME_PATH       a Chromium executable (a Playwright browser build)
// The theme is set on the root's data-theme attribute, since the switch lands in W6-CDX-44.

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: node capture.mjs <out-dir>');
const { CAPTURE_PASSWORD, CHROME_PATH } = process.env;
const USER = process.env.CAPTURE_USER ?? 'alice';
const OFF = process.env.CAPTURE_BASE;
const ON = process.env.CAPTURE_SUITE;
if (!CAPTURE_PASSWORD || !CHROME_PATH || !OFF || !ON) throw new Error('set CAPTURE_PASSWORD, CHROME_PATH, CAPTURE_BASE, CAPTURE_SUITE');

// Optional filters, for targeted captures: CAPTURE_ONLY (a regex on the page name), CAPTURE_THEMES (dark,light),
// CAPTURE_WIDTHS (1280,390) and CAPTURE_ACCENTS=0 to skip the accent picker.
const pick = (env, all) => (process.env[env] ? all.filter((x) => process.env[env].split(',').includes(x)) : all);
const ONLY = process.env.CAPTURE_ONLY ? new RegExp(process.env.CAPTURE_ONLY) : null;
const WIDTHS = [{ name: '1280', width: 1280, height: 860 }, { name: '390', width: 390, height: 844 }]
  .filter((w) => pick('CAPTURE_WIDTHS', [w.name]).includes(w.name));
const THEMES = pick('CAPTURE_THEMES', ['dark', 'light']);
const PAGES = [
  { name: 'home', base: OFF, route: '/' },
  { name: 'archive-list', base: OFF, route: '/archives' },
  { name: 'archive-view', base: OFF, route: '/archives/1' },
  { name: 'document-read', base: OFF, route: '/archives/1/doc/1' },
  { name: 'document-edit', base: OFF, route: '/editor/1' },
  { name: 'account-suite-on', base: ON, route: '/account' },
  { name: 'account', base: OFF, route: '/account', section: true },
  { name: 'admin', base: OFF, route: '/admin' },
  { name: 'notifications', base: OFF, route: '/notifications' },
  { name: 'github-history', base: OFF, route: '/github/acme/platform', github: true },
];
const ACCENTS = ['nova', 'cyan'];

// The GitHub surface reads the GitHub API through this server. The capture answers those calls with fixtures, so the
// repository and history pages render without a GitHub connection (no network, no token). Nothing else is intercepted.
const COMMITS = [
  { sha: '3f9a1c2e4b5d6a7f8091a2b3c4d5e6f708192a3b', message: 'Add a per-key rate limit to the gateway\n\nSliding window in Redis.', author: { login: 'bob', name: 'Bob', avatar_url: null }, date: '2026-10-10T09:14:00Z', additions: 42, deletions: 7 },
  { sha: '8c21d0a7e5f4b3a2918f7e6d5c4b3a2918f7e6d5', message: 'Document the batch endpoints', author: { login: 'alice', name: 'Alice', avatar_url: null }, date: '2026-10-08T16:02:00Z', additions: 118, deletions: 0 },
  { sha: 'b7e4a9d2c1f0e9d8c7b6a5948372615049382716', message: 'Remove the v1 webhook payloads', author: { login: 'dave', name: 'Dave', avatar_url: null }, date: '2026-10-05T11:40:00Z', additions: 3, deletions: 56 },
];
function mockGitHub(route) {
  const { pathname } = new URL(route.request().url());
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (pathname === '/api/github/status') return json({ success: true, connected: true, username: 'alice@acme.com', githubId: '1', login: 'alice', avatar_url: null, token_status: 'valid' });
  if (pathname === '/api/github/repos/acme/platform') return json({ success: true, name: 'platform', full_name: 'acme/platform', owner: { login: 'acme' }, default_branch: 'main', private: false, html_url: 'https://github.com/acme/platform' });
  if (pathname === '/api/github/repos/acme/platform/branches') return json({ success: true, branches: [{ name: 'main', commit: { sha: COMMITS[0].sha } }] });
  if (pathname === '/api/github/repos/acme/platform/commits') return json({ success: true, commits: COMMITS });
  if (pathname.startsWith('/api/github/repos/acme/platform/commits/')) return json({ success: true, ...COMMITS[0], files: [] });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ['--no-sandbox'] });
const failures = [];

// One sign-in per instance (the login route is rate-limited); later contexts start from its stored cookies.
const sessions = new Map();
async function signedIn(base, width, height) {
  const viewport = { width, height };
  if (!sessions.has(base)) {
    const probe = await browser.newContext({ viewport });
    if (base === ON && process.env.CAPTURE_SESSION_TOKEN) {
      // The suite-on instance refuses a password for an issuer-linked account, so its session is a row the
      // issuer would have minted (auth_provider oidc), presented as the cookie.
      await probe.addCookies([{ name: 'sessionToken', value: process.env.CAPTURE_SESSION_TOKEN, url: base }]);
    } else {
      const login = await probe.request.post(`${base}/api/login`, {
        data: { username: USER, password: CAPTURE_PASSWORD },
      });
      if (!login.ok()) throw new Error(`login to ${base} failed: ${login.status()}`);
      // The client stores the token it is handed (components/Login.jsx, setSessionCookie), so the capture does the same.
      const { token } = await login.json();
      await probe.addCookies([{ name: 'sessionToken', value: token, url: base }]);
    }
    sessions.set(base, await probe.storageState());
    await probe.close();
  }
  return browser.newContext({ viewport, deviceScaleFactor: 1, storageState: sessions.get(base) });
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // The first-run dialog opens over a new account's first page; the capture dismisses it, as a person would.
  const dismiss = page.getByRole('button', { name: 'Get Started' });
  if (await dismiss.count()) await dismiss.first().click().catch(() => {});
  await page.waitForTimeout(700);
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    for (const spec of PAGES.filter((p) => !ONLY || ONLY.test(p.name))) {
      // The standalone editor is for desktop widths only (App.jsx MobileEditorGuard), so a phone edit capture is the home page.
      if (spec.name === 'document-edit' && width.width < 600) continue;
      const context = await signedIn(spec.base, width.width, width.height);
      const page = await context.newPage();
      try {
        if (spec.github) await page.route('**/api/github/**', mockGitHub);
        await page.goto(`${spec.base}${spec.route}`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await settle(page);
        const file = path.join(outDir, `${spec.name}-${width.name}-${theme}.png`);
        if (spec.section) {
          const section = page.locator('.pref-section', { hasText: 'Accent Color' }).first();
          await section.scrollIntoViewIfNeeded();
          await section.screenshot({ path: file.replace('.png', '-accent-section.png') });
        }
        await page.screenshot({ path: file });
      } catch (err) {
        failures.push(`${spec.name} ${width.name} ${theme}: ${err.message}`);
      } finally {
        await context.close();
      }
    }
    // The accent picker, on two hues, from a stored preference applied at boot.
    for (const accent of process.env.CAPTURE_ACCENTS === '0' ? [] : ACCENTS) {
      const context = await signedIn(OFF, width.width, width.height);
      const page = await context.newPage();
      try {
        await page.goto(`${OFF}/account`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(({ a }) => localStorage.setItem('c2-user-prefs', JSON.stringify({ accentColor: a })), { a: accent });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await settle(page);
        const section = page.locator('.pref-section', { hasText: 'Accent Color' }).first();
        await section.scrollIntoViewIfNeeded();
        await section.screenshot({ path: path.join(outDir, `accent-${accent}-${width.name}-${theme}.png`) });
      } catch (err) {
        failures.push(`accent ${accent} ${width.name} ${theme}: ${err.message}`);
      } finally {
        await context.close();
      }
    }
  }
}
await browser.close();
console.log(failures.length ? `FAILURES:\n${failures.join('\n')}` : 'all captures written');
