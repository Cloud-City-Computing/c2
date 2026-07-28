# Five-Minute Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cloud Codex boot and be usable with no SMTP server configured, and land a fresh admin inside a real workspace instead of an empty app.

**Architecture:** `services/email.js` gains a boot-time capability flag (`initMail()` / `isMailEnabled()`). `sendEmail()` becomes a no-op when mail is off, so fire-and-forget callers need no changes. The three callers that carry a *required* payload (user invitations, squad invitations, password reset) degrade individually: invitations return their link in the HTTP response, reset returns an honest unavailable message. Email-2FA is blocked at enable time so its lockout pair is unreachable. Separately, `routes/admin.js` gains `bootstrapInstance()`, guarded on an empty `workspaces` table, which seeds one workspace / squad / archive / welcome document.

**Tech Stack:** Node 20, Express 5, MySQL 8 (`mysql2/promise`), Nodemailer, Vitest 4 + Supertest, Docker Compose.

**Spec:** [`docs/specs/2026-07-27-five-minute-evaluation.md`](../specs/2026-07-27-five-minute-evaluation.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Run all `npm` commands from `cloudcodex/`.** `make` and `docker compose` run from the repo root. There is no package.json at the root.
- **Every new source file opens with the project header block** (see any existing file in `cloudcodex/`): one-line description, then `All Rights Reserved to Cloud City Computing, LLC 2026` and `https://cloudcitycomputing.com`.
- **`no-console` is an ESLint error except `console.error`.** Error format is exactly `` `[${new Date().toISOString()}] ${req.method} ${req.path}:` `` plus the error, for request-scoped logs.
- **`no-implicit-coercion` is an ESLint error.** Use `Boolean(x)` and `Number(x)`, never `!!x` or `+x`.
- **All SQL is parameterized** via `c2_query(sql, params)`. Never template-interpolate user input.
- **Every async route handler is wrapped in `asyncHandler(...)`**, and every router file ends with `router.use(errorHandler)`.
- **Style:** 2-space indent, single quotes in JS, double quotes in JSX attributes, trailing semicolons. No Prettier, no TypeScript.
- **Tests mirror the source tree:** `routes/foo.js` to `tests/routes/foo.test.js`, `services/foo.js` to `tests/services/foo.test.js`.
- **Coverage thresholds are per-glob and CI enforces them.** Relevant floors: `services/email.js` 95% lines, `routes/admin.js` 90%, `routes/auth.js` 85%, `routes/squads.js` 85%, `middleware/**` 80%. Adding an uncovered branch to any of these fails CI even when every test passes.
- **Backend tests queue `c2_query` mocks in the exact order the handler issues queries.** Adding a query to a handler shifts the queue for every test that exercises it.
- **Never run `npm test` expecting a partial run to prove anything** ﹘ CI runs `npm ci && npm run lint && npm test && npm run test:coverage`.

---

## File Structure

**Modified:**

| File | Responsibility after this plan |
|---|---|
| `cloudcodex/services/email.js` | Owns the mail capability: config detection, boot-time verification, the enabled flag, and no-op send |
| `cloudcodex/server.js` | Boots regardless of mail state; logs the capability once; calls `bootstrapInstance()` |
| `cloudcodex/routes/admin.js` | Invitations return `signup_url`; exports `bootstrapInstance()` |
| `cloudcodex/routes/auth.js` | `2fa/enable` rejects `email` when mail is off; `forgot-password` degrades honestly |
| `cloudcodex/routes/squads.js` | Squad invite tolerates mail being off |
| `cloudcodex/src/pages/AdminPage.jsx` | Renders the returned invite link as copyable text |
| `cloudcodex/tests/setup.js` | Global email mock covers the new exports |
| `docker-compose-prod.yml`, `cloudcodex/Dockerfile`, `init.sql`, `.env.example` | Install correctness |

**No new source files.** The capability lives in the module that already owns mail; the bootstrap lives beside `ensureAdminUser` which it mirrors. No migration: the bootstrap writes rows, not schema.

---

### Task 1: Extend the global email mock

Do this first and alone. `tests/setup.js` replaces `services/email.js` with a factory mock that returns a fixed object. Any export the real module gains is `undefined` at import in all 30-plus backend test files until this mock lists it, which fails everything at once and looks unrelated to whatever you were doing.

**Files:**
- Modify: `cloudcodex/tests/setup.js:18-22`

**Interfaces:**
- Consumes: nothing.
- Produces: the global mock exposes `sendEmail`, `verifyEmailConnection`, `initMail`, `isMailEnabled`, `isMailConfigured`. Every later task depends on this.

- [ ] **Step 1: Extend the mock factory**

Replace the email mock block in `cloudcodex/tests/setup.js`:

```javascript
// Mock the email service
vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn(async () => ({ messageId: 'mock' })),
  verifyEmailConnection: vi.fn(async () => true),
  initMail: vi.fn(async () => ({ enabled: true, reason: null })),
  isMailEnabled: vi.fn(() => true),
  isMailConfigured: vi.fn(() => true),
}));
```

Defaulting `isMailEnabled` to `true` keeps every existing test on its current path, so this task changes no behaviour.

- [ ] **Step 2: Run the full suite to confirm nothing moved**

Run: `cd cloudcodex && npm test`
Expected: PASS, 57 files / 1128 tests, same as before.

- [ ] **Step 3: Commit**

```bash
git add cloudcodex/tests/setup.js
git commit -m "test: extend global email mock for the mail capability exports"
```

---

### Task 2: The mail capability in services/email.js

**Files:**
- Modify: `cloudcodex/services/email.js`
- Test: `cloudcodex/tests/services/email.test.js`

**Interfaces:**
- Consumes: Task 1's mock shape.
- Produces:
  - `isMailConfigured(): boolean` ﹘ true when `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` are all set.
  - `initMail(): Promise<{enabled: boolean, reason: string|null}>` ﹘ sets the module flag; call once at boot.
  - `isMailEnabled(): boolean` ﹘ the flag. False until `initMail()` resolves true.
  - `sendEmail({to, subject, text, html, from}): Promise<object>` ﹘ unchanged when enabled; resolves `{skipped: true, reason: 'mail disabled'}` when not.

`tests/services/email.test.js` already bypasses the global mock with `vi.unmock` plus a nodemailer mock, then top-level `await import`. Follow that existing pattern.

- [ ] **Step 1: Write the failing tests**

Append to `cloudcodex/tests/services/email.test.js`:

```javascript
describe('mail capability', () => {
  it('reports configured when all three SMTP vars are set', () => {
    expect(isMailConfigured()).toBe(true);
  });

  it('enables mail when verification succeeds', async () => {
    verifyMock.mockResolvedValueOnce(true);
    const result = await initMail();
    expect(result.enabled).toBe(true);
    expect(result.reason).toBeNull();
    expect(isMailEnabled()).toBe(true);
  });

  it('disables mail when verification fails, with a reason', async () => {
    verifyMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await initMail();
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('SMTP connection failed');
    expect(isMailEnabled()).toBe(false);
  });

  it('skips sending instead of throwing when mail is disabled', async () => {
    verifyMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await initMail();

    const result = await sendEmail({ to: 'a@b.com', subject: 'hi', text: 'x' });

    expect(result).toEqual({ skipped: true, reason: 'mail disabled' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('sends normally once mail is enabled again', async () => {
    verifyMock.mockResolvedValueOnce(true);
    await initMail();

    await sendEmail({ to: 'a@b.com', subject: 'hi', text: 'x' });

    expect(sendMailMock).toHaveBeenCalled();
  });
});
```

Extend the existing import at the top of the file to pull in the new names:

```javascript
const {
  sendEmail,
  verifyEmailConnection,
  initMail,
  isMailEnabled,
  isMailConfigured,
} = await import('../../services/email.js');
```

- [ ] **Step 2: Add the unconfigured-env test**

Env is read at module load, so this branch needs a fresh module. Append:

```javascript
describe('mail capability when SMTP is unconfigured', () => {
  it('reports not configured and never verifies', async () => {
    const saved = { ...process.env };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    vi.resetModules();

    const mod = await import('../../services/email.js');
    const result = await mod.initMail();

    expect(mod.isMailConfigured()).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('SMTP_HOST, SMTP_USER or SMTP_PASS not set');
    expect(mod.isMailEnabled()).toBe(false);

    process.env = saved;
    vi.resetModules();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd cloudcodex && npx vitest run tests/services/email.test.js`
Expected: FAIL with `initMail is not a function`.

- [ ] **Step 4: Implement the capability**

In `cloudcodex/services/email.js`, after the `DEFAULT_FROM` constant (line 29), add:

```javascript
// --- Mail capability ---
//
// Cloud Codex runs without SMTP. The capability is decided once at boot by
// initMail(): configuration present AND the connection verifies. Consumers
// that carry a required payload (invitations, password reset) check
// isMailEnabled() and degrade; fire-and-forget consumers need no changes
// because sendEmail() becomes a no-op.

let mailReady = false;

/** True when all three required SMTP variables are present. */
export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** True when mail is configured and verified. False until initMail() succeeds. */
export function isMailEnabled() {
  return mailReady;
}

/**
 * Determine mail availability once, at boot.
 * @returns {Promise<{enabled: boolean, reason: string|null}>}
 */
export async function initMail() {
  if (!isMailConfigured()) {
    mailReady = false;
    return { enabled: false, reason: 'SMTP_HOST, SMTP_USER or SMTP_PASS not set' };
  }
  const ok = await verifyEmailConnection();
  mailReady = ok;
  return { enabled: ok, reason: ok ? null : 'SMTP connection failed' };
}
```

Then change `sendEmail` (line 51) to short-circuit. Replace its opening line:

```javascript
export function sendEmail({ to, subject, text, html, from }) {
  if (!mailReady) {
    return Promise.resolve({ skipped: true, reason: 'mail disabled' });
  }
  return transporter.sendMail({
```

Leave the rest of the function body unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd cloudcodex && npx vitest run tests/services/email.test.js`
Expected: PASS.

- [ ] **Step 6: Run lint and the full suite**

Run: `cd cloudcodex && npm run lint && npm test`
Expected: both clean. The global mock from Task 1 keeps every other file on its existing path.

- [ ] **Step 7: Commit**

```bash
git add cloudcodex/services/email.js cloudcodex/tests/services/email.test.js
git commit -m "feat(email): add boot-time mail capability with no-op send when disabled"
```

---

### Task 3: server.js boots without SMTP

**Files:**
- Modify: `cloudcodex/server.js:16-42`
- Test: `cloudcodex/tests/server.test.js`

**Interfaces:**
- Consumes: `initMail()` from Task 2.
- Produces: a process that boots with no SMTP configuration.

- [ ] **Step 1: Write the failing test**

In `cloudcodex/tests/server.test.js`, extend the module mock list at the top so `initMail` is available:

```javascript
vi.mock('../services/email.js', () => ({
  verifyEmailConnection: vi.fn(async () => true),
  initMail: vi.fn(async () => ({ enabled: false, reason: 'SMTP_HOST, SMTP_USER or SMTP_PASS not set' })),
  isMailEnabled: vi.fn(() => false),
  isMailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
}));
```

Then add:

```javascript
describe('server.js: mail is optional', () => {
  it('does not exit when SMTP configuration is absent', async () => {
    const original = { ...process.env };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'pw';
    process.env.ADMIN_EMAIL = 'admin@test.com';

    await import('../server.js');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(listenMock).toHaveBeenCalled();

    process.env = original;
  });

  it('still exits when admin configuration is absent', async () => {
    const original = { ...process.env };
    delete process.env.ADMIN_USERNAME;

    await import('../server.js');

    expect(exitSpy).toHaveBeenCalledWith(1);

    process.env = original;
  });
});
```

Delete the three existing `exits with status 1 when SMTP_*` cases. They assert the behaviour this task removes, and leaving them means the suite contradicts itself.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cloudcodex && npx vitest run tests/server.test.js`
Expected: FAIL ﹘ `expect(exitSpy).not.toHaveBeenCalled()` receives 1 call.

- [ ] **Step 3: Remove the SMTP boot gates**

In `cloudcodex/server.js`, delete the whole SMTP block at lines 16-21 (the `if (!process.env.SMTP_HOST ...)` guard and its `process.exit(1)`). Keep the admin block at lines 23-28 exactly as it is.

Change the import on line 9 from `verifyEmailConnection` to `initMail`:

```javascript
import { initMail } from './services/email.js';
```

Then replace the verification block inside the listen callback (lines 33-38) with:

```javascript
  const mail = await initMail();
  if (mail.enabled) {
    console.log('✔ SMTP connection verified');
  } else {
    console.error(
      `✖ Email disabled: ${mail.reason}. ` +
      'Invites will show copyable links; password reset is unavailable.'
    );
  }
```

`console.error` rather than `console.log` is deliberate: `no-console` allows only `error`, and this belongs on stderr where an operator will see it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cloudcodex && npx vitest run tests/server.test.js`
Expected: PASS.

- [ ] **Step 5: Run lint and the full suite**

Run: `cd cloudcodex && npm run lint && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add cloudcodex/server.js cloudcodex/tests/server.test.js
git commit -m "feat(server): boot without SMTP, logging the mail capability once"
```

---

### Task 4: Invitations return the link

**Files:**
- Modify: `cloudcodex/routes/admin.js:253-272`
- Test: `cloudcodex/tests/routes/admin.test.js:365`

**Interfaces:**
- Consumes: `isMailEnabled()` from Task 2.
- Produces: `POST /api/admin/invitations` responds 201 with `{success: true, message, signup_url: string, emailed: boolean}`. Task 5 (frontend) consumes `signup_url` and `emailed`.

This also fixes a live bug: today a send failure returns 500 *after* the invitation row is inserted, orphaning an invite whose link nobody can recover.

- [ ] **Step 1: Write the failing tests**

In `cloudcodex/tests/routes/admin.test.js`, add `isMailEnabled` to the email import at the top of the file, then add inside the existing `describe('POST /api/admin/invitations')`:

```javascript
    it('returns the signup url and emails it when mail is enabled', async () => {
      mockAuthenticated(ADMIN_USER);
      isMailEnabled.mockReturnValue(true);
      c2_query.mockResolvedValueOnce([]);                  // no existing user
      c2_query.mockResolvedValueOnce([]);                  // no existing invitation
      c2_query.mockResolvedValueOnce({ insertId: 1 });     // insert invitation
      sendEmail.mockResolvedValueOnce({ messageId: 'sent' });

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com' });

      expect(res.status).toBe(201);
      expect(res.body.signup_url).toContain('?invite=');
      expect(res.body.emailed).toBe(true);
      expect(sendEmail).toHaveBeenCalled();
    });

    it('returns the signup url without sending when mail is disabled', async () => {
      mockAuthenticated(ADMIN_USER);
      isMailEnabled.mockReturnValue(false);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce({ insertId: 1 });

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com' });

      expect(res.status).toBe(201);
      expect(res.body.signup_url).toContain('?invite=');
      expect(res.body.emailed).toBe(false);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('still returns 201 with the link when sending throws', async () => {
      mockAuthenticated(ADMIN_USER);
      isMailEnabled.mockReturnValue(true);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce([]);
      c2_query.mockResolvedValueOnce({ insertId: 1 });
      sendEmail.mockRejectedValueOnce(new Error('smtp exploded'));

      const res = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', 'Bearer valid-token')
        .send({ email: 'newuser@test.com' });

      expect(res.status).toBe(201);
      expect(res.body.signup_url).toContain('?invite=');
      expect(res.body.emailed).toBe(false);
    });
```

Add `isMailEnabled.mockReturnValue(true);` to the file's existing `beforeEach` so the other tests keep their current behaviour after `resetMocks()`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd cloudcodex && npx vitest run tests/routes/admin.test.js -t invitations`
Expected: FAIL ﹘ `res.body.signup_url` is `undefined`.

- [ ] **Step 3: Implement**

In `cloudcodex/routes/admin.js`, add `isMailEnabled` to the existing import from `../services/email.js`. Then replace the `try { await sendEmail({...}) } catch {...}` block and the final `res.status(201)` (lines 255-272) with:

```javascript
  // The link is the mechanism; email is a convenience. Returning it
  // unconditionally means a mail failure degrades to a warning instead of
  // orphaning an invitation row whose token nobody can recover.
  let emailed = false;
  if (isMailEnabled()) {
    try {
      await sendEmail({
        to: trimmedEmail,
        subject: 'Cloud Codex — You\'ve Been Invited!',
        text: `You've been invited to join Cloud Codex!\n\nClick the link below to create your account (expires in 7 days):\n${signupUrl}\n\nIf you did not expect this invitation, you can safely ignore this email.`,
        html: `
        <h2>You're Invited to Cloud Codex!</h2>
        <p>You've been invited to join Cloud Codex, a collaborative document workspace.</p>
        <p><a href="${signupUrl}" style="display:inline-block;padding:12px 24px;background:#2ca7db;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Create Your Account</a></p>
        <p style="color:#999;font-size:13px;">This invitation expires in 7 days. If you did not expect this, you can safely ignore this email.</p>
      `,
      });
      emailed = true;
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}: invitation email failed:`, err);
    }
  }

  res.status(201).json({
    success: true,
    message: emailed
      ? `Invitation sent to ${trimmedEmail}`
      : `Invitation created for ${trimmedEmail}. Share the link below.`,
    signup_url: signupUrl,
    emailed,
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd cloudcodex && npx vitest run tests/routes/admin.test.js`
Expected: PASS. If the pre-existing `sends invitation email` case fails, check that `isMailEnabled.mockReturnValue(true)` is in `beforeEach`.

- [ ] **Step 5: Commit**

```bash
git add cloudcodex/routes/admin.js cloudcodex/tests/routes/admin.test.js
git commit -m "feat(admin): return invitation links in the response, mail optional"
```

---

### Task 5: Show the invite link in the admin UI

**Files:**
- Modify: `cloudcodex/src/pages/AdminPage.jsx:211`

**Interfaces:**
- Consumes: `signup_url` and `emailed` from Task 4.
- Produces: nothing consumed downstream.

`src/pages/` is out of unit-test scope by policy, so this task is verified in the browser rather than by a test.

- [ ] **Step 1: Render the link after a successful invite**

At `cloudcodex/src/pages/AdminPage.jsx:211` the handler already holds the response as `res`. Store the returned link in state and render it. Add near the panel's other state:

```javascript
  const [lastInvite, setLastInvite] = useState(null);
```

In the invite handler, after `const res = await createAdminInvitation(email);`:

```javascript
      setLastInvite({ url: res.signup_url, emailed: res.emailed, email });
```

Then render below the invite form:

```jsx
      {lastInvite ? (
        <div className="invite-link-callout">
          <p>
            {lastInvite.emailed
              ? `Invitation emailed to ${lastInvite.email}. You can also share this link:`
              : `Invitation created for ${lastInvite.email}. Email is disabled on this instance, so share this link:`}
          </p>
          <input className="invite-link-input" type="text" readOnly value={lastInvite.url} />
          <button
            className="btn btn-secondary"
            onClick={handleCopyInviteLink}
          >
            Copy link
          </button>
        </div>
      ) : null}
```

And the handler, named per the `react/jsx-handler-names` rule (`onFoo` prop, `handleFoo` function):

```javascript
  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(lastInvite.url);
    toastSuccess('Invite link copied');
  };
```

Import `toastSuccess` from `../components/Toast` if it is not already imported. Do **not** use `window.alert`: `no-alert` is an ESLint error.

- [ ] **Step 2: Run lint**

Run: `cd cloudcodex && npm run lint`
Expected: clean. Watch for `react/jsx-handler-names` and `react/self-closing-comp`.

- [ ] **Step 3: Verify in the browser**

Run: `cd cloudcodex && npm run dev`, log in as admin, open Admin, Invitations, and create an invite. Confirm the link renders and Copy works, at both desktop and mobile widths.

- [ ] **Step 4: Commit**

```bash
git add cloudcodex/src/pages/AdminPage.jsx
git commit -m "feat(admin-ui): show and copy the invitation link"
```

---

### Task 6: Block email-2FA when mail is off

**Files:**
- Modify: `cloudcodex/routes/auth.js:761-766`
- Test: `cloudcodex/tests/routes/auth.test.js`

**Interfaces:**
- Consumes: `isMailEnabled()` from Task 2.
- Produces: `POST /api/2fa/enable` returns 400 for `method: 'email'` when mail is disabled.

Without this guard a user could enable email-2FA on a mail-less instance and then be unable to log in (`auth.js:329` never sends the code) *and* unable to disable it (`auth.js:908` never sends the confirmation). This single check makes both unreachable.

- [ ] **Step 1: Write the failing tests**

Add `isMailEnabled` to the email import in `cloudcodex/tests/routes/auth.test.js`, add `isMailEnabled.mockReturnValue(true)` to `beforeEach`, then add:

```javascript
  describe('POST /api/2fa/enable with mail disabled', () => {
    it('rejects email 2FA with 400', async () => {
      mockAuthenticated();
      isMailEnabled.mockReturnValue(false);

      const res = await request(app)
        .post('/api/2fa/enable')
        .set('Authorization', 'Bearer valid-token')
        .send({ method: 'email' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/email is disabled/i);
      expect(c2_query).not.toHaveBeenCalled();
    });

    it('still allows TOTP', async () => {
      mockAuthenticated();
      isMailEnabled.mockReturnValue(false);
      c2_query.mockResolvedValueOnce({ affectedRows: 1 });

      const res = await request(app)
        .post('/api/2fa/enable')
        .set('Authorization', 'Bearer valid-token')
        .send({ method: 'totp' });

      expect(res.status).toBe(200);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd cloudcodex && npx vitest run tests/routes/auth.test.js -t "mail disabled"`
Expected: FAIL ﹘ first case returns 200.

- [ ] **Step 3: Implement**

Add `isMailEnabled` to the existing `../services/email.js` import in `cloudcodex/routes/auth.js`. Then in `POST /2fa/enable`, insert the guard immediately after `const method = req.body.method || 'email';` (line 762):

```javascript
  // Email 2FA on a mail-less instance is a lockout: the login code and the
  // disable-confirmation code both travel by email.
  if (method === 'email' && !isMailEnabled()) {
    return res.status(400).json({
      success: false,
      message: 'Email is disabled on this instance. Use an authenticator app (TOTP) instead.',
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd cloudcodex && npx vitest run tests/routes/auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudcodex/routes/auth.js cloudcodex/tests/routes/auth.test.js
git commit -m "feat(auth): refuse email 2FA when mail is disabled"
```

---

### Task 7: Password reset degrades honestly

**Files:**
- Modify: `cloudcodex/routes/auth.js:580-585`
- Test: `cloudcodex/tests/routes/auth.test.js`

**Interfaces:**
- Consumes: `isMailEnabled()` from Task 2.
- Produces: `POST /api/forgot-password` returns 200 `{success: false, message}` when mail is off.

The early return goes **before** the user lookup, so no reset token is minted that could never be delivered. Enumeration safety is unaffected: the response is identical for every address.

- [ ] **Step 1: Write the failing test**

```javascript
  describe('POST /api/forgot-password with mail disabled', () => {
    it('reports unavailable without touching the database', async () => {
      isMailEnabled.mockReturnValue(false);

      const res = await request(app)
        .post('/api/forgot-password')
        .send({ email: 'user@test.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/unavailable/i);
      expect(c2_query).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cloudcodex && npx vitest run tests/routes/auth.test.js -t "forgot-password with mail disabled"`
Expected: FAIL ﹘ `success` is `true`.

- [ ] **Step 3: Implement**

In `POST /forgot-password`, immediately after the email validation block (after line 585), insert:

```javascript
  // Return before minting a token: a reset token that can never be delivered
  // is worse than an honest refusal. Identical for every address, so this
  // leaks nothing about which accounts exist.
  if (!isMailEnabled()) {
    return res.json({
      success: false,
      message: 'Password reset is unavailable on this instance. Contact your administrator.',
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cloudcodex && npx vitest run tests/routes/auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudcodex/routes/auth.js cloudcodex/tests/routes/auth.test.js
git commit -m "feat(auth): honest password-reset refusal when mail is disabled"
```

---

### Task 8: Squad invites tolerate mail being off

**Files:**
- Modify: `cloudcodex/routes/squads.js:396-414`
- Test: `cloudcodex/tests/routes/squads.test.js`

**Interfaces:**
- Consumes: `isMailEnabled()` from Task 2.
- Produces: squad invite succeeds with mail off; the in-app `squad_invite` notification still fires.

Today a send failure returns 500 at `squads.js:412` **after** the `squad_invitations` row is inserted, so the invite exists but the caller sees an error.

- [ ] **Step 1: Write the failing test**

```javascript
    it('creates the invitation when mail is disabled', async () => {
      mockAuthenticated();
      isMailEnabled.mockReturnValue(false);
      c2_query.mockResolvedValueOnce([{ id: 1, name: 'Squad', workspace_id: 1, owner: TEST_USER.email }]);
      c2_query.mockResolvedValueOnce([{ id: 2 }]);        // invited user exists
      c2_query.mockResolvedValueOnce([]);                 // not already a member
      c2_query.mockResolvedValueOnce([]);                 // no pending invitation
      c2_query.mockResolvedValueOnce({ insertId: 10 });   // insert invitation
      c2_query.mockResolvedValueOnce([{ email: 'b@test.com', name: 'B' }]);

      const res = await request(app)
        .post('/api/squads/1/members/invite')
        .set('Authorization', 'Bearer valid-token')
        .send({ userId: 2 });

      expect(res.status).toBe(200);
      expect(sendEmail).not.toHaveBeenCalled();
    });
```

The mock queue must match the handler's real query order. If this fails on an ordering mismatch, read the handler top to bottom and count the `c2_query` calls before the insert rather than guessing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cloudcodex && npx vitest run tests/routes/squads.test.js -t "mail is disabled"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `cloudcodex/routes/squads.js`, add `isMailEnabled` to the `../services/email.js` import. Then change the guard on line 397 from `if (invitedUser?.email) {` to:

```javascript
  if (invitedUser?.email && isMailEnabled()) {
```

and replace the two lines inside the `catch` (lines 411-412) so a send failure no longer aborts the request:

```javascript
    } catch (err) {
      // The in-app squad_invite notification below is the reliable channel;
      // a failed email must not fail an invitation that is already persisted.
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}: squad invitation email failed:`, err);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd cloudcodex && npx vitest run tests/routes/squads.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudcodex/routes/squads.js cloudcodex/tests/routes/squads.test.js
git commit -m "feat(squads): keep invitations working when mail is disabled"
```

---

### Task 9: Install fixes

**Files:**
- Modify: `docker-compose-prod.yml`, `cloudcodex/Dockerfile`, `init.sql:12-31`, `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: a production compose stack that reaches its database.

No unit tests: this is configuration, verified in Task 11 by actually running it.

- [ ] **Step 1: Point the app container at the database service**

In `docker-compose-prod.yml`, add to the `app` service, as a sibling of `env_file`:

```yaml
    environment:
      DB_HOST: database
```

`.env` supplies `DB_HOST=localhost`, correct for dev where the app runs on the host and wrong in-container. An explicit `environment` entry takes precedence over `env_file`.

- [ ] **Step 2: Use the lockfile in the image**

In `cloudcodex/Dockerfile`, change `RUN npm install` to:

```dockerfile
RUN npm ci
```

Safe: `cloudcodex/package-lock.json` is committed (388 KB) and CI already runs `npm ci` against it.

- [ ] **Step 3: Complete the DROP block**

In `init.sql`, add these four lines to the `DROP TABLE IF EXISTS` block (lines 12-31), before `DROP TABLE IF EXISTS favorites;`:

```sql
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS watches;
DROP TABLE IF EXISTS activity_log;
DROP TABLE IF EXISTS github_links;
```

These four are the only tables of the 25 missing from the list, and none of their `CREATE TABLE` statements uses `IF NOT EXISTS`, which is why `make reset-db` aborts partway on an existing database. The block already runs under `SET FOREIGN_KEY_CHECKS = 0`, so ordering does not matter.

- [ ] **Step 4: Document the env reality**

In `.env.example`, replace the SMTP header comment:

```
# ─── SMTP (optional) ────────────────────────────────────────
# Leave blank to run without email. The app boots either way.
# With email disabled: invitations return a copyable link in the admin UI,
# password reset is unavailable, and email-based 2FA cannot be enabled
# (authenticator-app TOTP still works).
```

And append a new block:

```
# ─── Runtime ─────────────────────────────────────────────────
# 'production' tightens CORS to CORS_ORIGIN only. Anything else also allows
# localhost origins. Leave unset for development.
NODE_ENV=
```

- [ ] **Step 5: Verify the compose file parses**

Run: `docker compose -f docker-compose-prod.yml config >/dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose-prod.yml cloudcodex/Dockerfile init.sql .env.example
git commit -m "fix(install): correct prod DB_HOST, use npm ci, complete init.sql DROP block"
```

---

### Task 10: Seed a real workspace on first boot

**Files:**
- Modify: `cloudcodex/routes/admin.js` (the `ensureAdminUser` region), `cloudcodex/server.js`
- Test: `cloudcodex/tests/routes/admin.test.js`

**Interfaces:**
- Consumes: `createDefaultPermissions`, `addSquadOwnerMember` from `routes/helpers/shared.js`.
- Produces:
  - `ensureAdminUser(): Promise<number|null>` ﹘ **changed**: now returns the admin's user id (it currently returns `undefined`).
  - `bootstrapInstance(adminId: number): Promise<boolean>` ﹘ true when it seeded, false when it no-opped.

Three details are load-bearing:

1. `workspaces.owner` is a `TEXT` column holding an **email address** (`init.sql:39`), not a foreign key. Clause 4 of the access fragments matches on it (`routes/helpers/ownership.js:30`), so it must receive `ADMIN_EMAIL`.
2. The archive's `squad_id` **must be set**. An archive with `squad_id NULL` is orphaned: clauses 4 through 7 of `readAccessWhere` all evaluate false and only the creator can reach it. That is the existing bug in `/api/setup`.
3. The guard is `COUNT(*) FROM workspaces = 0`, which makes this idempotent across restarts and unable to disturb an existing install.

- [ ] **Step 1: Write the failing tests**

In `cloudcodex/tests/routes/admin.test.js`, import `bootstrapInstance` alongside the router, then add:

```javascript
describe('bootstrapInstance', () => {
  it('seeds workspace, squad, archive and welcome doc on an empty install', async () => {
    c2_query.mockResolvedValueOnce([{ n: 0 }]);          // workspace count
    c2_query.mockResolvedValueOnce({ insertId: 11 });    // workspace
    c2_query.mockResolvedValueOnce({ insertId: 22 });    // squad
    c2_query.mockResolvedValueOnce({ insertId: 33 });    // squad_members
    c2_query.mockResolvedValueOnce({ insertId: 44 });    // archive
    c2_query.mockResolvedValueOnce({ insertId: 55 });    // log

    const seeded = await bootstrapInstance(1);

    expect(seeded).toBe(true);

    const archiveCall = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO archives'));
    expect(archiveCall).toBeDefined();
    // squad_id is the second bound param and must not be null, or the
    // archive is orphaned and unreachable by anyone but its creator.
    expect(archiveCall[1][1]).toBe(22);

    const workspaceCall = c2_query.mock.calls.find(([sql]) => sql.includes('INSERT INTO workspaces'));
    expect(workspaceCall[1][1]).toBe(process.env.ADMIN_EMAIL);
  });

  it('does nothing when a workspace already exists', async () => {
    c2_query.mockResolvedValueOnce([{ n: 3 }]);

    const seeded = await bootstrapInstance(1);

    expect(seeded).toBe(false);
    expect(c2_query).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no admin id is supplied', async () => {
    const seeded = await bootstrapInstance(null);

    expect(seeded).toBe(false);
    expect(c2_query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd cloudcodex && npx vitest run tests/routes/admin.test.js -t bootstrapInstance`
Expected: FAIL ﹘ `bootstrapInstance is not a function`.

- [ ] **Step 3: Make ensureAdminUser return the id**

In `cloudcodex/routes/admin.js`, change the existing-user branch to `return existing.id;` and the create branch to `return result.insertId;` after `createDefaultPermissions(result.insertId)`.

- [ ] **Step 4: Implement bootstrapInstance**

Add below `ensureAdminUser`, importing `addSquadOwnerMember` from `./helpers/shared.js`:

```javascript
const WELCOME_HTML = `
<h1>Welcome to Cloud Codex</h1>
<p>This document lives inside the structure Cloud Codex uses to organise everything:</p>
<ul>
  <li><strong>Workspace</strong> is the top level, usually your company or team.</li>
  <li><strong>Squad</strong> is a group of people inside it. Membership and permissions are set here.</li>
  <li><strong>Archive</strong> is a collection of related documents. Access is granted at this level.</li>
  <li><strong>Log</strong> is a document, like this one.</li>
</ul>
<p>You are the owner of this workspace, so you can rename anything, invite people from the Admin console, and create as many squads and archives as you need.</p>
<h2>Try it</h2>
<p>Edit this page. Open it in two browser windows and watch the changes sync live: that is the CRDT-backed collaborative editor, not a periodic save.</p>
<p>When you are ready, invite someone from <strong>Admin, Invitations</strong>. If this instance has no email configured, you will get a copyable invite link instead.</p>
`;

/**
 * Seed a usable instance on first boot so a new admin does not land in an
 * empty app. Guarded on an empty workspaces table, so it is idempotent
 * across restarts and never disturbs an existing install.
 *
 * @param {number|null} adminId
 * @returns {Promise<boolean>} true when it seeded
 */
export async function bootstrapInstance(adminId) {
  if (!adminId) return false;

  const [row] = await c2_query('SELECT COUNT(*) AS n FROM workspaces', []);
  if (Number(row?.n ?? 0) > 0) return false;

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminName = process.env.ADMIN_USERNAME;

  // workspaces.owner is a TEXT column holding an email, not a foreign key.
  const workspace = await c2_query(
    'INSERT INTO workspaces (name, owner) VALUES (?, ?)',
    [`${adminName}'s Workspace`, adminEmail]
  );

  const squad = await c2_query(
    'INSERT INTO squads (workspace_id, name, created_by) VALUES (?, ?, ?)',
    [workspace.insertId, 'General', adminId]
  );

  await addSquadOwnerMember(squad.insertId, adminId);

  // squad_id MUST be set. A NULL squad_id orphans the archive: clauses 4
  // through 7 of readAccessWhere all fail and only the creator can reach it.
  const archive = await c2_query(
    `INSERT INTO archives (name, squad_id, created_by, read_access, write_access)
     VALUES (?, ?, ?, JSON_ARRAY(?), JSON_ARRAY(?))`,
    ['Getting Started', squad.insertId, adminId, adminId, adminId]
  );

  // Static authored content, not user input, so it does not pass through
  // sanitizeHtml. Never interpolate anything into WELCOME_HTML.
  await c2_query(
    `INSERT INTO logs (archive_id, title, html_content, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?)`,
    [archive.insertId, 'Welcome to Cloud Codex', WELCOME_HTML, adminId, adminId]
  );

  console.error(`[${new Date().toISOString()}] bootstrap: seeded starter workspace for ${adminEmail}`);
  return true;
}
```

- [ ] **Step 5: Call it at boot**

In `cloudcodex/server.js`, change the import on line 13 to `import { ensureAdminUser, bootstrapInstance } from './routes/admin.js';` and replace line 41:

```javascript
  const adminId = await ensureAdminUser();
  await bootstrapInstance(adminId);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd cloudcodex && npx vitest run tests/routes/admin.test.js`
Expected: PASS. Existing tests that exercise `ensureAdminUser` may fail on **mock ordering** because the boot path now issues more queries. Those are ordering artifacts, not regressions: re-align their `mockResolvedValueOnce` queues.

- [ ] **Step 7: Run lint and the full suite**

Run: `cd cloudcodex && npm run lint && npm test`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add cloudcodex/routes/admin.js cloudcodex/server.js cloudcodex/tests/routes/admin.test.js
git commit -m "feat(bootstrap): seed a starter workspace on first boot"
```

---

### Task 11: Verify the five-minute claim and update the maps

The spec's success criterion is a real stopwatch run from a clean clone, not a reasoned argument. Do it literally.

**Files:**
- Modify: `docs/maps/request-lifecycle.md`, `docs/maps/build-test-and-ops.md`, `docs/maps/open-questions.md`
- Delete: `docs/specs/2026-07-27-five-minute-evaluation.md`

- [ ] **Step 1: Confirm coverage thresholds still hold**

Run: `cd cloudcodex && npm run test:coverage`
Expected: PASS with no threshold violations. `services/email.js` (95% lines), `routes/admin.js` (90%), `routes/auth.js` (85%) and `routes/squads.js` (85%) all gained branches in this plan.

- [ ] **Step 2: Do the clean-clone run**

```bash
cd /tmp && rm -rf c2-eval && git clone https://github.com/Cloud-City-Computing/c2.git c2-eval
cd c2-eval && git checkout <this-branch>
cp .env.example .env
# set ONLY: MYSQL_ROOT_PASSWORD, DB_PASS, ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL
# leave every SMTP_* blank
docker compose -f docker-compose-prod.yml up --build
```

Then open `http://localhost:3000`, log in with the admin credentials, and confirm you land on **Welcome to Cloud Codex** inside Getting Started. Time it from `git clone` to the visible document.

Expected: no crash on boot, one `Email disabled:` line on stderr, under five minutes.

- [ ] **Step 3: Confirm the degraded paths in that same instance**

- Admin, Invitations, create one: the copyable link appears and says email is disabled.
- Account settings, enable 2FA by email: refused with the TOTP suggestion.
- Log out, Forgot password: reports unavailable.

- [ ] **Step 4: Tear down**

```bash
cd /tmp/c2-eval && docker compose -f docker-compose-prod.yml down -v
cd /tmp && rm -rf c2-eval
```

`-v` matters: it drops the named volume, so the next run genuinely re-tests first boot.

- [ ] **Step 5: Update the maps**

- `docs/maps/request-lifecycle.md`: the boot-order table still says missing SMTP config and failed verification each exit 1. Replace both rows with the capability behaviour, and add `bootstrapInstance` to the boot sequence.
- `docs/maps/build-test-and-ops.md`: remove the `DB_HOST` and `npm install` warnings from the Docker section; note that `init.sql`'s DROP block is now complete.
- `docs/maps/open-questions.md`: delete item **B3** (`make reset-db` fails) and the `DB_HOST` note, both now fixed. Leave B1, B2, B4, B5, B6, B7 and all of section A untouched: this plan does not address them.

- [ ] **Step 6: Delete the spec**

Per `docs/specs/README.md`, a spec is removed once its work ships and the maps cover it. Delete `docs/specs/2026-07-27-five-minute-evaluation.md` and its two rows in `docs/specs/README.md` and `docs/README.md`. Keep `docs/specs/roadmap.md`, and mark track A shipped there.

- [ ] **Step 7: Commit**

```bash
git add docs/
git commit -m "docs: reconcile maps with the mail-optional boot, retire the track A spec"
```

- [ ] **Step 8: Open the PR and watch CI**

```bash
gh pr create --base main --title "Five-minute evaluation: mail optional, seeded first boot" --body "..."
gh pr checks --watch
```

CI runs only against `main`, so a PR is the only way to get a signal. Do not call this done off a pending or red run.

---

## Self-Review

**Spec coverage.** Section 1 (mail capability) is Task 2. Section 2 (consumer degradation) is Tasks 4 through 8: invitations 4 and 5, email-2FA 6, password reset 7, squad invites 8; the two fire-and-forget consumers (`services/notifications.js`, and `auth.js:800` TOTP QR) need no code change because `sendEmail` no-ops, which Task 2 tests directly. Section 3 (install fixes) is Task 9, all four items. Section 4 (non-empty first boot) is Task 10. Section 5 (testing) is distributed across every task, with both named landmines handled: the mock shape in Task 1, the queue shift in Task 10 Step 6. Section "Done means" is Task 11. No gaps.

**Placeholders.** None. Every code step carries the actual code. The one `--body "..."` in Task 11 Step 8 is a PR description, written at the time from the commits.

**Type consistency.** `isMailEnabled()`, `isMailConfigured()`, `initMail()` are declared in Task 2 and used with those exact names in Tasks 1, 3, 4, 6, 7, 8. `initMail()` returns `{enabled, reason}`, consumed with those keys in Task 3. `ensureAdminUser()` changes from returning `undefined` to returning `number|null` in Task 10 Step 3, consumed in Step 5. `bootstrapInstance(adminId)` returns `boolean`, asserted as such in the tests. Response fields `signup_url` and `emailed` are produced in Task 4 and consumed in Task 5 under the same names.

**Ordering.** Task 1 must precede everything. Task 2 must precede 3, 4, 6, 7, 8. Tasks 4 through 9 are independent of each other. Task 10 is independent of 2 through 9 but its Step 6 assumes the suite is otherwise green. Task 11 is last.
