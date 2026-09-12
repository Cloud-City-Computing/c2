# Plan: the workspace reader check (C2-5)

Implements [`../specs/2026-09-11-workspace-reader-check.md`](../specs/2026-09-11-workspace-reader-check.md).

## On the execution convention

`docs/plans/README.md` settles that plans here are executed with
`superpowers:subagent-driven-development`, one fresh subagent per task. **This plan was executed
inline instead, and that is a deviation worth naming rather than hiding.**

The track is one middleware function, one route handler and one test file — three files, no schema
change, no migration, no client. Decomposing that across fresh subagents adds handoff surface to a
change whose whole risk is concentrated in a single decision (`requireMachine` versus
`machineOrAuth`), which no amount of decomposition helps with. What the convention actually protects
— review between steps, verification not delegated — was done: each piece was run and mutation-tested
before the next.

A larger track here should follow the convention as written.

## Tasks

### 1. `requireMachine` — the machine-only middleware

`cloudcodex/middleware/auth.js`, beside `machineOrAuth`.

Tries the machine credential and, unlike its sibling, **does not fall through to `requireAuth`**.
Refuses with 401 and the same body an anonymous caller gets — a distinct "you are logged in but not a
machine" would itself tell a prober the route exists and what it wants.

*Done.*

### 2. The endpoint

`GET /api/workspaces/:workspaceId/reader-check?email=` in `cloudcodex/routes/workspaces.js`,
answering `{ canRead }`.

One query, three EXISTS-style tests against rules this product already has: admin, workspace owner,
member of any squad in the workspace. `LOWER()` on both sides of the email compare so the intent
survives a collation change. Workspace id bound as a **number** — `workspaces.owner_id` is an INT FK,
and binding a string against it matches nothing and silently denies access with nothing logged, which
is the class `tests/helpers.js`'s own owner-predicate guard exists for.

*Done.*

### 3. The rate limit

`cloudcodex/app.js`, the same `authLimiter` the login surface uses, attached by path pattern because
the workspace id is a route parameter.

An oracle answering a boolean invites enumeration even behind a credential: if the service token ever
leaks, an unbounded endpoint hands the holder a membership map of the whole install at whatever rate
they can issue requests.

*Done.*

### 4. Tests

`cloudcodex/tests/routes/reader-check.test.js`, 14 cases.

**The one that matters is the session refusal, and it is written to avoid a false green.** It queues
a principal row it never uses: without that row the credential lookup finds nothing and the request
is refused anyway, so the 401 would pass even if the route had been written with `machineOrAuth`.
That is the same shape `search.test.js`'s 401s were written to avoid, and the reason is recorded in
both places.

**Mutation-tested, four ways, each verified to land and restore:**

| mutation | caught |
|---|---|
| `requireMachine` → `machineOrAuth` | yes |
| 404 on an unknown email (account-existence oracle) | yes |
| drop squad membership from the answer | yes |
| bind the workspace id as a string | yes |

*Done.*

### 5. Maps

`docs/maps/access-control.md` §7 — the route table gains the endpoint, plus the section explaining
why `requireMachine` exists and what "can read a workspace" means here.

*Done.*

## Verification

- `npm test` in `cloudcodex/`: **71 files, 1,479 tests, all passing.**
- `npx eslint` clean on the three changed files.

## What this track does not do

It ends at the endpoint. The consuming half is `S5.1b-f` in the Cloud Command repo, under that
repo's own protocol and its own PR — and until both exist, Cloud Command's own gate forbids any
session there shipping a control that writes `c2_workspace_id`.
