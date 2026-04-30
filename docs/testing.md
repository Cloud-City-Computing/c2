```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   TESTING                                                                  ║
║   Vitest 4 + Supertest + jsdom — 1128 tests across 57 files, no services.  ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Testing

Cloud Codex has **1128 tests across 57 files** and runs the entire suite in
under 30 seconds with no MySQL, no SMTP, and no network. Backend tests use
**Vitest 4** + **Supertest** with the database, email transport, and
filesystem globally mocked. Frontend tests use **Vitest** + **jsdom** +
`@testing-library/react`.

```bash
cd cloudcodex
npm test               # both projects
npm run test:watch     # both projects, watch mode
npm run test:backend   # backend project only
npm run test:frontend  # frontend project only
npm run test:coverage  # both + v8 coverage report (HTML + lcov + text)
```

---

## Two Vitest projects, one command

`vitest.config.js` defines two named projects so a single `npm test` runs
backend and frontend together with the right environment for each:

```
   ┌─────────────────────────────────────────────────────────────┐
   │                       npm test                              │
   │                          │                                  │
   │      ┌───────────────────┴───────────────────┐              │
   │      ▼                                       ▼              │
   │   project: backend                    project: frontend     │
   │   environment: node                   environment: jsdom    │
   │   setup: tests/setup.js               setup: tests/setup.frontend.js │
   │   include:                            include:              │
   │     tests/routes/**                     tests/src/**         │
   │     tests/middleware/**                                       │
   │     tests/services/**                                         │
   │     tests/helpers/**                                          │
   │     tests/extensions/**                                       │
   │     tests/*.test.{js,jsx}                                     │
   └─────────────────────────────────────────────────────────────┘
```

Both projects share the same coverage config so `npm run test:coverage`
produces one unified report.

---

## What's covered, by area

| Area                              | Files in `tests/`             | Notes                                  |
|-----------------------------------|--------------------------------|----------------------------------------|
| HTTP routes                       | `tests/routes/*.test.js`       | Supertest against the Express app      |
| Middleware                        | `tests/middleware/*.test.js`   | `auth.js`, `permissions.js`            |
| Services (collab, email, notif)   | `tests/services/*.test.js`     | Includes WebSocket + email pipelines   |
| Route helpers                     | `tests/helpers/*.test.js`      | `ownership`, `shared`, `images`, `mentions`, `activity` |
| Tiptap extensions                 | `tests/extensions/*.test.js`   | e.g. `Mention`                         |
| Framework files                   | `tests/{app,server,mysql_connect}.test.js` | App wiring, startup, DB pool |
| Frontend pure logic               | `tests/src/{editorUtils,userPrefs,util}*.test.js(x)` | jsdom + RTL  |
| Frontend hooks                    | `tests/src/hooks/*.test.jsx`   | `useCollab`, `useNotificationChannel`, `useGitHubLink`, `useGitHubStatus`, `usePresence`, `useClickOutside` |
| Frontend reusable components      | `tests/src/components/*.test.jsx` | Bell, Item, Toast, Dialog, Form, Manager, Tree, etc. |
| Frontend libs                     | `tests/src/lib/*.test.js`      | e.g. `githubDiff`                      |

Pages (`src/pages/*.jsx`) are **out of scope** for unit tests today — the
giants like `Editor.jsx` and `GitHubPage.jsx` need refactoring that extracts
logic into testable hooks before they're worth unit-testing.

---

## What gets mocked

`tests/setup.js` (backend) replaces these globally so tests run without
external dependencies:

- `mysql_connect.js` → in-memory `c2_query` mock (fixtures stub queries)
- `services/email.js` → `sendEmail` recorded, never sent
- `sharp` → image transforms become no-ops (returns the input buffer)
- `fs` writes for avatars / doc-images → recorded but never hit disk

`tests/setup.frontend.js` (frontend) registers `@testing-library/jest-dom`
matchers and resets `localStorage`, `sessionStorage`, and the DOM between
tests.

`tests/helpers.js` exports common fixtures (`TEST_USER`, `ADMIN_USER`) and
auth helpers (`mockAuthenticated`, `mockUnauthenticated`, `resetMocks`).

See [`cloudcodex/tests/README.md`](../cloudcodex/tests/README.md) for the
full set of patterns and examples.

---

## Coverage thresholds (CI gate)

`vitest.config.js` enforces per-glob coverage thresholds. The **global
floor** is set just below the currently achieved coverage so normal churn
doesn't block CI, but a meaningful regression will. **Security-critical
modules** are locked at higher floors:

| Glob                      | Lines | Statements | Branches | Functions |
|---------------------------|-------|------------|----------|-----------|
| **global floor**          |  43   |  40        |  33      |  26       |
| `routes/helpers/**`       |  88   |  85        |  65      |  90       |
| `middleware/**`           |  80   |  78        |  70      |  70       |
| `routes/auth.js`          |  85   |  85        |  82      |  95       |
| `routes/admin.js`         |  90   |  90        |  88      |  90       |
| `routes/archives.js`      |  90   |  88        |  75      |  90       |
| `routes/comments.js`      |  92   |  90        |  85      |  95       |
| `routes/documents.js`     |  95   |  92        |  88      |  88       |
| `routes/notifications.js` |  95   |  95        |  88      |  95       |
| `routes/squads.js`        |  85   |  75        |  65      |  95       |
| `routes/watches.js`       |  85   |  85        |  73      |  95       |
| `services/email.js`       |  95   |  95        |  70      |  95       |
| `services/email-templates.js` | 95 | 90 | 90 | 95 |
| `services/notifications.js` | 90 | 88 | 80 | 88 |
| `services/collab.js`      |  65   |  65        |  50      |  75       |
| `mysql_connect.js`        |  85   |  85        |  80      |  90       |
| `src/editorUtils.js`      |  95   |  95        |  88      |  95       |
| `src/userPrefs.js`        |  95   |  95        |  80      |  95       |
| `src/lib/**`              |  90   |  90        |  70      |  80       |

Hooks and other frontend modules each have their own targeted floors —
see `vitest.config.js` for the canonical list.

> The global floor is intentionally low because pages (`src/pages/*`) and
> some heavy components are unmeasured. **Don't read it as the project's
> health number** — read the per-glob thresholds for the modules that
> matter.

---

## Adding tests with new code

The convention: **a route, service, helper, middleware, hook, pure-JS
utility, or reusable component change requires a matching test update in
the same shape as its neighbors.** Tests mirror the source tree:

```
   routes/foo.js            →  tests/routes/foo.test.js
   services/foo.js          →  tests/services/foo.test.js
   middleware/foo.js        →  tests/middleware/foo.test.js
   routes/helpers/foo.js    →  tests/helpers/foo.test.js
   src/foo.js               →  tests/src/foo.test.js
   src/components/Foo.jsx   →  tests/src/components/Foo.test.jsx
   src/hooks/useFoo.js      →  tests/src/hooks/useFoo.test.jsx
```

Pages are explicitly out of scope until the underlying logic is hookified.
