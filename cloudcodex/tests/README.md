# Cloud Codex — Testing Guide

Vitest 4 + Supertest for backend, Vitest 4 + jsdom + Testing Library for frontend.
The two suites run as separate Vitest **projects** so a single `npm test` (or
`npm run test:coverage`) runs both with the right environment for each.

## Running tests

```bash
npm test                 # both suites, no coverage
npm run test:watch       # watch mode (both)
npm run test:backend     # node project only — routes / middleware / services / helpers
npm run test:frontend    # jsdom project only — src/* utilities, hooks, components
npm run test:coverage    # full suite with v8 coverage and threshold check
```

CI runs `npm run lint && npm test && npm run test:coverage`. Threshold violations
fail the build.

## Layout

```
tests/
├── helpers.js              ← TEST_USER, mockAuthenticated, resetMocks, ...
├── setup.js                ← backend project setup: c2_query / email / sharp mocks
├── setup.frontend.js       ← frontend project setup: jest-dom, DOM/storage cleanup
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
