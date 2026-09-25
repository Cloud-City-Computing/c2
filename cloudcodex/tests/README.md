# Cloud Codex — Testing Guide

Vitest 4 + Supertest for backend, Vitest 4 + jsdom + Testing Library for frontend.
The two suites run as separate Vitest **projects** so a single `npm test` (or
`npm run test:coverage`) runs both with the right environment for each. A third,
opt-in project, `integration`, runs `tests/integration/` against a live MySQL
server (see [Live-MySQL integration tests](#live-mysql-integration-tests)).

## Running tests

```bash
npm test                 # both suites, no coverage
npm run test:watch       # watch mode (both)
npm run test:backend     # node project only — routes / middleware / services / helpers
npm run test:frontend    # jsdom project only — src/* utilities, hooks, components
npm run test:coverage    # full suite with v8 coverage and threshold check
npm run test:integration # opt-in: tests/integration/ against a live MySQL
```

CI runs `npm run lint && npm test && npm run test:integration && npm run test:coverage && npm run build`.
Threshold violations fail the build.

`test`, `test:watch` and `test:coverage` name `--project backend --project frontend`
explicitly; a bare `vitest run` would run the integration project too.
`tests/test-projects.test.js` pins that split for all three.

## Layout

```
tests/
├── helpers.js              ← TEST_USER, mockAuthenticated, resetMocks, ...
├── setup.js                ← backend project setup: c2_query / email / sharp mocks
├── setup.frontend.js       ← frontend project setup: jest-dom, DOM/storage cleanup
├── setup.integration.js    ← integration project setup: a throwaway schema, NO mocks
├── test-projects.test.js   ← pins which projects the default run names
├── integration/            ← live-MySQL tests (opt-in, npm run test:integration)
│   ├── global-setup.js     ← teardown: fails the run if a c2_it_ schema leaked
│   ├── mysql-admin.js      ← admin connection, build-from-init.sql, drop helpers
│   ├── pre-runner-state.js ← per post-baseline migration: the SQL that undoes it on init.sql
│   ├── migrate.test.js     ← the migration runner on a real database
│   └── upgrade-path.test.js ← every post-baseline migration's SQL, run for real
├── routes/                 ← per-route HTTP integration tests (Supertest)
├── middleware/             ← middleware unit tests
├── services/               ← service-layer tests (email, notifications, collab)
├── helpers/                ← routes/helpers/* unit tests (shared, ownership, images)
└── src/                    ← frontend tests (jsdom)
    ├── editorUtils.test.js
    ├── userPrefs.test.js
    ├── util.test.js
    ├── lib/githubDiff.test.js
    ├── hooks/*.test.jsx
    └── components/*.test.jsx
```

## Backend patterns

### Route tests

Use Supertest against the real `app.js`. The global setup mocks `c2_query`,
`generateSessionToken`, `validateAndAutoLogin`, `touchSession`, `sendEmail`, and
`sharp` — no real DB or email is touched.

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { c2_query } from '../../mysql_connect.js';
import { mockAuthenticated, mockUnauthenticated, resetMocks } from '../helpers.js';

describe('GET /api/foo/:id', () => {
  beforeEach(() => resetMocks());

  it('returns the foo when the user has access', async () => {
    mockAuthenticated();                          // TEST_USER, id=1
    c2_query.mockResolvedValueOnce([{ id: 7 }]);  // canned DB result

    const res = await request(app)
      .get('/api/foo/7')
      .set('Authorization', 'Bearer t');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, foo: { id: 7 } });
  });
});
```

Use `c2_query.mockResolvedValueOnce(...)` chained per query the route makes.
Inspect SQL with `c2_query.mock.calls[N][0]` and params with `[N][1]`.

### Service / helper tests that need the *real* module

The global setup mocks `mysql_connect.js` and `services/email.js` for route
tests — but if you're testing the helper itself, use `vi.unmock` and re-mock
its boundary (e.g. `nodemailer`):

```js
vi.unmock('../../services/email.js');
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: ... }) } }));
const { sendEmail } = await import('../../services/email.js');
```

### Async helper functions

Wrap every async route handler in `asyncHandler(...)` and remember:
`expect(...).rejects.toThrow(...)` only matches **Promise** rejections. If the
function throws synchronously (e.g. `sanitizeHeaderValue`), use
`expect(() => fn()).toThrow(...)`.

## Frontend patterns

### Pure logic

Put tests next to siblings under `tests/src/`. The frontend project uses jsdom
and auto-cleans the DOM and localStorage / sessionStorage between tests
(see `tests/setup.frontend.js`).

```js
import { describe, it, expect } from 'vitest';
import { timeAgo } from '../../src/util.jsx';

it('returns "5m ago" for under-an-hour timestamps', () => {
  const t = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  expect(timeAgo(t)).toBe('5m ago');
});
```

### Hooks — `renderHook`

```js
import { renderHook, waitFor, act } from '@testing-library/react';
import useThing from '../../../src/hooks/useThing.js';

vi.mock('../../../src/util.jsx', () => ({
  fetchSomething: vi.fn(async () => ({ ok: true })),
}));

it('loads on mount', async () => {
  const { result } = renderHook(() => useThing());
  await waitFor(() => expect(result.current.loaded).toBe(true));
});
```

When a hook reads from `localStorage`, `document.cookie`, etc., assume jsdom
provides it — there's no extra setup. Use `act(() => ...)` to wrap state
updates triggered outside React's event handlers (timers, fake WS messages).

### Components — `render` + Testing Library queries

Default to **role queries** over selectors. Wrap in `MemoryRouter` if the
component uses `<Link>` or `useNavigate`.

```js
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

it('clicking confirm calls onConfirm', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn(() => Promise.resolve());
  wrap(<ConfirmDialog title="t" message="m" onConfirm={onConfirm} />);

  await user.click(screen.getByRole('button', { name: /delete/i }));
  // Assertions about loading state, etc.
});
```

### WebSockets

The pattern in `tests/services/collab.test.js` uses a **real** `http.createServer()`
with a real `ws` client. For frontend hooks that consume a WebSocket
(`useNotificationChannel`, `useCollab`), stub the global with a fake class:

```js
class FakeWebSocket {
  static instances = [];
  constructor(url) { this.url = url; FakeWebSocket.instances.push(this); /* ... */ }
  addEventListener(name, fn) { /* ... */ }
  send(data) { this.sent.push(data); }
  close() { /* dispatch close */ }
  dispatch(name, payload) { /* manually fire events */ }
}
vi.stubGlobal('WebSocket', FakeWebSocket);
```

## Coverage thresholds

`vitest.config.js` sets per-glob thresholds (e.g. `routes/helpers/**`,
`services/email.js`, `src/userPrefs.js`). The numbers are calibrated to
**actually-achieved coverage minus a small buffer**, so:

- a few uncovered lines in routine churn won't block CI
- a meaningful regression (e.g. a test deleted, a whole branch removed) **will**

When you add tests that significantly raise coverage in one of these areas,
ratchet the threshold up too — that locks the gain in.

When you add a brand-new file under a directory that isn't thresholded, no
new threshold is required; the global floor still applies.

## Required tests for changes

- New or modified **route** in `routes/*.js` → update `tests/routes/<name>.test.js`.
- New or modified **service** in `services/*.js` → update or create the matching
  test file.
- New **helper** in `routes/helpers/*.js` → matching `tests/helpers/*.test.js`.
- New **hook** in `src/hooks/*.js` → matching `tests/src/hooks/*.test.jsx`.
- New **reusable component** in `src/components/*.jsx` → matching test file.
  Pages (`src/pages/*.jsx`) are still out of scope by default.

## Live-MySQL integration tests

`tests/integration/` is the one place tests reach a real database. Use it for
anything a mocked `c2_query` cannot prove: that `init.sql` builds, that a
migration file's SQL runs and converges on `init.sql`, and SQL whose behaviour
depends on MySQL itself.

**Running it.** Any MySQL 8.4 answering on **3306** (`mysql_connect.js` reads no
`DB_PORT`). A scratch container is simplest:

```bash
docker run -d --rm --name c2-it-mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=<pw> mysql:8.4
IT_DB_ROOT_PASSWORD=<pw> npm run test:integration
docker stop c2-it-mysql
```

| Variable | Default | Meaning |
|---|---|---|
| `IT_DB_ROOT_PASSWORD` | none, required | admin password; the setup throws without it |
| `IT_DB_ROOT_USER` | `root` | an account that can `CREATE DATABASE` and `DROP DATABASE` |
| `IT_DB_HOST` | `127.0.0.1` | the server; it must listen on 3306 |

These are read from the shell environment only, never from `.env`.

**What the setup gives each file.** `tests/setup.integration.js` runs before the
file is imported. It creates a throwaway `c2_it_<random>` schema, builds
`init.sql` into it, adopts it with `runMigrations({ adoptFreshInstall: true })`,
and points `DB_HOST`/`DB_USER`/`DB_PASS`/`DB_NAME` at it, so importing
`mysql_connect.js` (or `app.js`) gives you a real pool on a real, fully migrated
schema. Nothing is mocked. The schema is dropped in `afterAll`, and the global
teardown fails the run if any `c2_it_` schema survives.

**What it does not run.** Adoption records every migration file and executes
none, so the setup never runs a migration's SQL. `upgrade-path.test.js` is what
does: it builds `init.sql`, undoes every post-baseline file with the statements
in `pre-runner-state.js` (newest first), records the pre-runner baseline, lets
the runner apply every newer file for real, and compares the result with a
fresh `init.sql` build. **A new migration file needs an entry in
`pre-runner-state.js`**, the statement that removes its change from an
`init.sql` build; the test names any file that lacks one. The upgrade runs on
empty tables, so if a migration transforms existing rows, write a test that
seeds them.

**Writing one.** Name it `tests/integration/<area>.test.js`. Import app modules
normally; they bind to the file's schema. If a test needs a second schema (for
example one deliberately missing a column), build it with
`buildSchemaFromInitSql` from `tests/integration/mysql-admin.js` and drop it in
the test's own `finally`. Hand the migration runner a `queryVia(connection)`
executor over one connection, never a pool: its advisory lock is per
connection. Tests in one file share a schema, so clean up rows you rely on
being absent.
