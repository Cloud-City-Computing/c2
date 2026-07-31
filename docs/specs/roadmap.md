# Roadmap

Agreed 2026-07-27. The restart goal is **adoption: get real users running Cloud
Codex**, approached install-first, because neither audience (self-hosters or
teams) can currently get past setup.

---

## Where the project actually stands

177 commits between February and April 2026, then three months dark from
2026-04-29 to 2026-07-27. It stopped at a clean point rather than mid-flight:
the last five commits were the test-coverage ratchet and the documentation
overhaul, immediately after the GitHub integration and notification work landed.

- Zero open issues, zero open pull requests. No written backlog exists.
- One stale branch, `accountSettingsWireframe` (February), already superseded.
- Public repo, **37 stars, 1 fork**, one `Alpha v0.1` pre-release from
  2026-03-28.
- Working tree clean, suite green (57 files, 1128 tests), maps current.

The 37 stars matter: that is organic interest with effectively no marketing
behind it. Discovery is working. The question is what happens next to those
people.

## The diagnosis: discovery works, evaluation is a wall

Tracing the path a stranger takes from "starred the repo" to "using it":

**Wall 1, you cannot boot the app without a working SMTP server.**
`server.js:17-21` exits when `SMTP_HOST`, `SMTP_USER` or `SMTP_PASS` is missing.
`server.js:33-38` then *live-verifies* the connection and calls
`process.exit(1)` on failure. There is no bypass, not even for `NODE_ENV`.
So evaluating this product requires provisioning a mail relay first.

**Wall 2, a fresh admin lands in a completely empty app.**
`ensureAdminUser()` in `routes/admin.js` creates a user row and a permissions
row, and nothing else. No workspace, no squad, no archive, no document. The new
admin must construct a four-level hierarchy from scratch using vocabulary they
have never encountered. The onboarding component that exists,
`src/components/WelcomeSetup.jsx`, is a dead-end modal reading "Your
administrator will assign you to workspaces and squads", and it renders only for
**invited** users (`src/components/Login.jsx:193`), never for the admin. The one
`/api/setup` endpoint (`routes/auth.js:180`) creates an archive with
`squad_id NULL`, which is an orphaned archive reachable only by its creator.

**Supporting friction**, all previously recorded in
[`../maps/open-questions.md`](../maps/open-questions.md): the production compose
file ships `DB_HOST=localhost`, which is wrong inside a container; the Dockerfile
uses `npm install` rather than `npm ci`; `make reset-db` aborts partway on any
existing database.

The leak is overwhelmingly at evaluation and install. Features are not the
constraint right now.

## The five tracks

| | Track | Scope | Depends on |
|---|---|---|---|
| **A** | Evaluation path — **shipped** | Mail optional, install defects, non-empty first boot | nothing |
| **B** | First-run experience | Real guided onboarding, retire or fix `/api/setup` | A |
| **C** | Vocabulary and hierarchy | Workspaces → Squads → Archives → Logs | decide early, execute late |
| **D** | Trust signals | Real releases, changelog, classifiable license, screenshots | A |
| **E** | Foundation | The two giant page files, the open-questions defect list | nothing, but competes for time |

### A. Evaluation path — shipped

Removed both walls: the app boots with no SMTP configured (`initMail()`
degrades instead of exiting) and a fresh admin now lands inside a seeded
workspace (`bootstrapInstance()`). Verified with a clean-clone Docker boot.
The spec that scoped this work has been deleted per the `docs/specs/`
convention; see [`../maps/request-lifecycle.md`](../maps/request-lifecycle.md)
and [`../maps/build-test-and-ops.md`](../maps/build-test-and-ops.md) for how it
works now.

This is first because it is the cheapest change that converts attention already
earned into users, and because it produces the signal (issues, forks, questions)
that should aim every track after it.

### B. First-run experience

Once people can get in, make the first ten minutes teach the product. Replace
`WelcomeSetup.jsx` with a real guided flow, and decide whether `/api/setup`
should survive at all rather than patching its orphaned-archive bug in place.

Deferred behind A because it lands in the UI layer, which carries the
`src/pages/` testing problem described in track E.

### C. Vocabulary and hierarchy

**Decide early even though we execute late.** Cloud Codex uses four levels with
invented names: Workspaces → Squads → Archives → Logs. Confluence is Spaces →
Pages. Notion is Teamspaces → Pages. Every evaluator arrives with one of those
models and has to translate.

The hierarchy is baked into the schema, every route, the entire UI, all the
documentation, and 1128 tests, so renaming is a large breaking change. **Its
cost only ever increases with each new user and each new self-hosted install
carrying real data.** That makes it the one item where deferring the *decision*
is more expensive than deferring the *work*.

The open questions: is four levels one too many, and are the names worth the
translation tax they charge? Track A's welcome document is a cheap down payment
either way, since it teaches the model by being an instance of it.

### D. Trust signals

A self-hoster evaluating an unfamiliar platform checks for signals that it is
maintained: tagged releases (there is one pre-release from March), a changelog,
a license GitHub can classify (currently reported as "Other"), and screenshots
proving the collaborative editing is real. Cheap, and it compounds with A.

### E. Foundation

`src/pages/Editor.jsx` (1516 lines) and `src/pages/GitHubPage.jsx` (2631 lines)
hold most of the interface and are explicitly out of test scope by policy. Any
significant UI work either drags their extraction along or piles onto them.
Plus the suspected defects in
[`../maps/open-questions.md`](../maps/open-questions.md), of which the
highest-value is **B1**: PR-as-document sessions grant access by writing
`logs.read_access`, a column nothing reads, so the feature is likely admin-only
in practice.

This track has no dependencies and competes purely for time. The argument for
doing some of it early is that B is blocked behind it in practice; the argument
against is that it produces nothing a user can see.

## Sequencing

```
now         A ────────────────────────────► ship, then measure
                    │
                    ├──► D  (cheap, parallel, compounds with A)
                    │
                    └──► B  (needs the signal from A to aim it)
                              │
                    E ────────┘  (extraction unblocks B's UI work)

            C: decide in principle now, execute when the answer is worth the break
```

After A ships, re-read this file before picking the next track. The measurement
that should drive it: do the 37 stars convert into issues, forks, and questions?
That tells us whether the wall was the only thing in the way.
