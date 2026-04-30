```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   CONTRIBUTING                                                             ║
║   How to land a change in Cloud Codex without breaking anyone's day.       ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Contributing to Cloud Codex

Thanks for thinking about contributing. This guide is short on purpose —
the durable conventions live in [`CLAUDE.md`](./CLAUDE.md), the docs in
[`docs/`](./docs/), and the test suite in `cloudcodex/tests/`. This file
just tells you how to ship a change.

---

## The contribution flow

```
   ┌─────────┐   ┌────────┐   ┌────────────┐   ┌────────┐   ┌────┐   ┌──────┐
   │ open    │──►│ branch │──►│ change +   │──►│ lint + │──►│ PR │──►│ CI   │
   │ issue   │   │ from   │   │ tests      │   │ test   │   │    │   │ green│
   │ (or skip│   │ main   │   │            │   │ locally│   │    │   │ merge│
   │  small) │   └────────┘   └────────────┘   └────────┘   └────┘   └──────┘
   └─────────┘
```

Small fixes (typos, obvious bugs) can skip the issue. Anything that
changes behavior, adds a feature, or touches more than one area of the
code should start with an issue so the design is agreed before time goes
into it.

---

## Before you start

1. **Read the relevant docs.** The biggest time sink in this codebase is
   reinventing something that already exists. The reuse table in
   [`CLAUDE.md`](./CLAUDE.md) names the helpers for the most common
   tasks (validation, sanitization, access checks, API calls, toasts,
   confirms, presence, email, image extraction).
2. **Look at the existing tests.** `cloudcodex/tests/` mirrors the
   source tree. The shape of a route test, a service test, or a
   component test is already established — match it.
3. **No new dependency without discussing.** Especially: no logging
   library, no metrics agent, no new search engine, no Redis, no
   service worker, no second WebSocket server. The single-process,
   no-broker architecture is load-bearing for self-hosting.

---

## Style

ESLint is the source of truth — `eslint.config.js`. Notable rules:

- `no-var`, `prefer-const`, `eqeqeq`
- `no-console: warn (allow: [error])` — never `console.log` in committed
  code; use `console.error` with the established prefix:
  `` `[${new Date().toISOString()}] ${req.method} ${req.path}:` ``
- `no-alert` — no `window.alert`
- `react/jsx-handler-names` — handler **props** are `onFoo`,
  **handlers** are `handleFoo`

There is no Prettier and no TypeScript. Match the surrounding file's
style: 2-space indent, single quotes in JS, double quotes in JSX
attributes, trailing semicolons. Every new source file under
`cloudcodex/` opens with the standard header — copy it from any
neighboring file.

---

## Tests

A change to a route, service, helper, middleware, hook, pure-JS
utility, or reusable component requires a matching test update in
the same shape as its neighbors. Pages (`src/pages/*`) are out of
scope for unit tests today.

```bash
cd cloudcodex

npm run lint          # must be clean — CI fails otherwise
npm test              # 1128 tests today; both backend and frontend
npm run test:coverage # if your change touches a glob with a per-glob
                      # threshold (see vitest.config.js)
```

There are **no pre-commit hooks** — local lint/test is on you. CI
(`.github/workflows/ci.yml`) runs `npm ci && npm run lint && npm test`
on push and PR to `main`.

---

## Database changes

Schema changes are dual-tracked: every column or table added in a
`migrations/*.sql` file must also appear in `init.sql`. Fresh installs
use `init.sql`; existing deployments apply migrations in order. Both
must converge to the same schema.

Migrations are additive — once a file ships, it is never rewritten.

---

## Commits

Commit style is conventional-ish: short imperative subject, optional
body. Recent examples:

```
test: close gaps from plan audit
test: ratchet thresholds, add testing patterns doc, update CLAUDE.md
test: cover reusable React components
```

Don't `--no-verify`. Don't `--amend` published commits. Don't `git push
--force` on `main`.

---

## Pull requests

The PR description should explain **why**, not just what — a reviewer
should understand the motivation in two minutes. Mention:

- The user-visible change (or "no user-visible change" if it's
  refactor / test / docs)
- New env vars, if any (also add to `.env.example`)
- Any migration added (also added to `init.sql`)
- Areas that need extra eyes if the change touches access control,
  the editor, the collab WS, or the auth flow

CI must be green before merge. There's no magic — `npm run lint &&
npm test` is the full bar.

---

## Reporting security issues

Please don't open a public issue for security vulnerabilities. See
[`SECURITY.md`](./SECURITY.md) for the disclosure process.
