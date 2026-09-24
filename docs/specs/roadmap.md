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

## The tracks

| | Track | Scope | Depends on |
|---|---|---|---|
| **A** | Evaluation path — **shipped** | Mail optional, install defects, non-empty first boot | nothing |
| **B** | First-run experience (**shipped**) | Real guided onboarding for every user including the admin, invite-carried squad assignment, `/api/setup` retired | A |
| **C** | Vocabulary and hierarchy (**decided**) | Names and level count both stay; day-one users meet Squad → Archive → Log | decided 2026-08-08 |
| **D** | Trust signals (**mostly shipped**) | Real releases, changelog, screenshots. Classifiable license declined | A |
| **E** | Foundation (**defects shipped**) | E1 the open-questions defect list, shipped 2026-08-09; E2 the two giant page files, open | nothing, but competes for time |
| **S** | Security and infrastructure (**shipped**) | C2-0 the merge gate, C2-1 four cross-tenant escalations, C2-2 token purpose confusion, C2-3 a migration runner, C2-4 one scoped service token, C2-5 a workspace reader check for the suite | nothing; C2-0 gates the rest |
| **W** | Wave 6, the suite (**specced 2026-09-24**) | Four sub-tracks: identity (W6-CDX-2 to 9), outbound events (W6-CDX-12 to 16), UI and tokens (W6-CDX-21 to 29), hosting readiness (W6-CDX-31 to 36), all after the shared live-MySQL test project W6-CDX-10 | S; named Cloud Command and Cloud City ID sessions per sub-track |

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

### B. First-run experience (shipped)

Replaced `WelcomeSetup.jsx`'s dead-end modal with a real welcome, mounted via
a new `FirstRunGate` in `Std_Layout`'s authenticated branch, which is what
finally makes it reachable for the admin (previously it rendered only from an
imperative call in `Login.jsx`, so the admin, synced from `.env` at boot
rather than signing up, could never see one). The welcome creates nothing:
it points at whatever squad, archive and document the user already has,
resolved through a new `GET /api/first-run`, or, for a user in no squad yet,
at their pending squad invitations if any exist.

`POST /api/admin/invitations` can now optionally carry a `squadId`, `role`
and permission flags, so an invited user joins that squad the moment they
create their account, in the same transaction, rather than landing with
nothing to see. `POST /api/setup` decided the answer to "should it survive":
no. It had no callers and its only behaviour was creating an archive with
`squad_id NULL`, an orphaned archive only its creator could ever reach; it
and its dead `setupWorkspace` frontend wrapper are deleted.

Verified end-to-end against a real database and a real browser: a squad-less
invite, a squad-carrying invite, and the admin's own first login after a
fresh boot.

Deferred behind A because it lands in the UI layer, which carries the
`src/pages/` testing problem described in track E; in practice the new
surface area (`useFirstRun`, `FirstRunGate`, `WelcomeSetup`) is small enough
that it did not need E's extraction work to be unit-testable.

### C. Vocabulary and hierarchy (decided 2026-08-08)

**The names stay, the level count stays, and the translation tax gets paid at
the presentation layer.** Recorded here because this was always meant to be
decided early and executed late; the decision is now made and the execution is
mostly "keep doing what the URL scheme already does".

Three findings shaped it:

1. **It is five levels, not four.** `logs.parent_id` is live: `archives.js`
   assembles a document tree and `src/components/PageTree.jsx` renders it. So
   the real model is Workspace → Squad → Archive → Log → nested Logs, against
   Confluence's Space → Page → nested Page. The component that draws the
   deepest level is already named after the outside vocabulary.
2. **Workspace is the thinnest level, and the only plausible cut.** It is four
   columns, it has no members of its own (membership lives entirely in
   `squad_members`), only an admin can create one, and it earns its keep in
   exactly two places: grouping squads, and the `read_access_workspace` /
   `write_access_workspace` flag that is clause 7 of the ACL fragments.
3. **But it is not ours alone to cut.** Cloud Command uses `workspace` as its
   **tenant boundary**, with every row below scoped to a `workspace_id` and
   Postgres RLS built on it, and its `NORTH_STAR.md` commits to adopting this
   product's vocabulary rather than renaming. Removing the level here would
   desync the suite at the top of the shared model, at exactly the level the
   other product uses for isolation. Renaming has the same problem, for the
   same reason.

So neither rename nor removal is a Cloud Codex-only lever, and the schema keeps
all four levels. What is decided instead is a presentation commitment:

> **A day-one user meets three levels: Squad → Archive → Log.** Workspace is an
> administrative concept that appears where it is managed, not something a new
> user must learn in order to reach their first document.

That is already true of the URL scheme (`/archives/:archiveId/doc/:logId`
mentions neither workspace nor squad) and of track B's welcome, which walks
squad → archive → log. This makes the existing behaviour a rule rather than an
accident, and it is the standard any new surface is held to.

**The honest limit of this decision:** it reduces *encountered* complexity, not
real complexity. Four levels still exist and an admin still meets all four.
Anyone reading this looking for "we simplified the hierarchy" will not find it.

**What would reopen it:** a real install needing more than one workspace (which
would make the level load-bearing here too, settling it the other way), or
Cloud Command moving off `workspace` as its tenant boundary (which would remove
the constraint that decided this).

### D. Trust signals (mostly shipped)

A self-hoster evaluating an unfamiliar platform checks for signals that it is
maintained. The measurement this file asked for came back weak: 38 stars, 1
fork, 2 issues ever and both closed. Nothing about the repository said
"maintained", so this track was picked next.

Shipped: a `CHANGELOG.md` reconstructed back to the March alpha, the version
reconciled to **0.9.0** (`package.json` claimed 1.0.0 while the only tag was a
pre-release), a `release.yml` that verifies and then publishes
`ghcr.io/cloud-city-computing/cloud-codex` on a version tag, a
`docker-compose-release.yml` that runs a release without a build toolchain,
README screenshots including a two-browser shot of one document open as two
users, and a `CODE_OF_CONDUCT.md`.

**Deliberately not done: the classifiable licence.** GitHub reports "Other"
because the `LICENSE` is a bespoke source-available text, and `licensee`
matches only known licence texts, so no rewording can change the badge. The
only fix is adopting a standard licence, which is a business decision rather
than a docs one. It was considered and declined, and the badge stays "Other".

Two things found by actually running the built image, both recorded in
[`../maps/open-questions.md`](../maps/open-questions.md):

- **B12, fixed:** production CORS rejected the app's own login request, so the
  documented self-hosting path could not log in at all.
- **B11, fixed:** navigating away from the editor blanked the whole app. The
  overlays were portalled into ProseMirror-owned DOM; they are now siblings
  inside a React-owned host. The app also gained its **first `ErrorBoundary`**,
  which is what turned that unmount race from a cosmetic bug into a total
  outage, and which E inherits as a solved problem.
- **B13, fixed:** document titles were click-only and unreachable by keyboard
  in every list view. Each now exposes a real named link or button.

### E. Foundation

Two halves that want separate sessions. **The defect half shipped 2026-08-09**;
the extraction half is what remains.

#### E1. The open-questions defect list (shipped)

Every item was confirmed against a real database before being fixed, and
re-measured after. Detail, with the evidence, in
[`../maps/open-questions.md`](../maps/open-questions.md).

| | Was | Now |
|---|---|---|
| **B1** | PR-as-document granted access by writing `logs.read_access`, which nothing reads, so the feature was admin-only. The session route also never asked GitHub whether the caller could see the PR. | Grant lands on a hidden archive **per PR**; the session route fetches the PR through the caller's token first. |
| **B4** | `GET`/`PUT`/`DELETE /api/github/link/:logId` checked nothing. Any user could read, repoint or delete any document's GitHub binding, and `/push` reads its target off that row. | Gated on read, write and write. |
| **B6** | A read-only collab participant could rename a document, which also mailed every watcher. | Gated on `canWrite` like every other mutating message. |
| **B2** | `html_content` was `TEXT`, so a 70 KiB save 500'd and the edit was lost. | All three content columns `MEDIUMTEXT`. |
| **B5** | Team sync fetched one page and deleted every member past it. | Paginated; a truncated listing removes nobody. |
| **B7** | The `email_squad_invite` toggle did nothing. | Honoured. |
| **A3** | `squad_permissions` was enforced by nothing. | Removed, table and routes. |

Three of these were reachable by any authenticated user, and the suite was
green throughout: none of them was a test failure waiting to be noticed.

**B13 shipped 2026-08-09**: document titles were click-only `<div>`/`<span>`
elements, so no list view offered any way to open a document without a mouse.
Each of the three live views now exposes a real named link or button, verified
by keyboard against a running app. It turned up two follow-ons, both filed:
**B15**, glyph-only controls that announce as "☆ button" rather than their
purpose, and `SearchResultItem`, a component with no callers anywhere in
`src/`.

**A1 and A2 stay open by decision**: `logs.read_access` remains deliberately
dead (B1 routes around it rather than reviving it), and `github_embed_refs`
still has no writer.

#### E2. The extraction (in progress)

`src/pages/Editor.jsx` and `src/pages/GitHubPage.jsx` (2652 lines) hold most of
the interface and are explicitly out of test scope by policy. Any significant UI
work either drags their extraction along or piles onto them. This is what
"track E" now means.

**First cut, 2026-08-10.** `Editor.jsx` went from 1520 to 1332 lines. Moved out,
each with the tests the page could never have:

| Extracted | To | Why it was worth doing first |
|---|---|---|
| `sanitizeHtml`, `htmlToMarkdown`, `markdownToHtml` | `src/editorUtils.js` | Pure functions behind markdown mode and GitHub round-tripping, previously uncovered |
| `ReadOnlyContent` | `src/components/editor/ReadOnlyContent.jsx` | Renders saved HTML with `dangerouslySetInnerHTML`; its sanitizing is load-bearing |
| `VersionHistory` | `src/components/editor/VersionHistory.jsx` | Restore and delete are destructive and had no frontend coverage at all |

`marked.setOptions({ breaks, gfm })` moved from `Editor.jsx` to sit beside
`markdownToHtml`, its only caller, and both options now have tests. **This was
cohesion, not a bug fix, and no call site was ever mis-ordered**: `marked` is a
module singleton, but `markdownToHtml` was defined in `Editor.jsx` itself, and
ESM runs a module body to completion before any of its exports can be called.
`GitHubPage.jsx` sets the same two options for itself. Keeping the
configuration next to the parsing is what makes that stay true now that the
function lives elsewhere and is independently importable.

Still inside `Editor.jsx`: `TiptapToolbar`, `RichTextEditor`, `MarkdownEditor`,
and the ~690-line `Editor` component itself. `GitHubPage.jsx` is untouched.

### S. Security and infrastructure (shipped 2026-09-12)

Added 2026-09-08. C2-0 to C2-4 shipped on 2026-09-09 across PRs #45, #47, #48,
#46 and #49, in that order. C2-5, the workspace reader check, followed as #51
and merged on 2026-09-12. The specs and plans that scoped the track have been
deleted per the `docs/specs/` convention (the C2-0 to C2-4 pair in #50, the
C2-5 pair on 2026-09-24); they remain readable in git history at `3cce3eb` and
`84de05c`. The maps are the record now. See
[`../maps/access-control.md`](../maps/access-control.md) for the tenant
boundary and machine principals, including `requireMachine` and the reader
check (section 7),
[`../maps/data-model.md`](../maps/data-model.md) for the typed token pool and
`schema_migrations`, [`../maps/build-test-and-ops.md`](../maps/build-test-and-ops.md)
for the migration runner and the CI gate, and
[`../../docs/security.md`](../security.md) for the cross-tenant audit queries.
Tracks A through E are all aimed at adoption, which left this project with no
written security track at all while four cross-tenant escalations and a
credential-flow defect sat in the tree.

Unlike the other tracks it is not justified by adoption. Cloud City proposes to
operate this software for money, and C2-1 through C2-3 are live defects in a
multi-tenant product, so they are owed on that basis alone. Only C2-4, the
scoped service token, and C2-5, the reader check, exist because another product
is waiting on them.

C2-0 came first and was a hard gate: before it, `main` required a review but no
status checks, so a red run was mergeable, and C2-2 rewrote the credential
reset path. Since C2-0 the `Lint, test and build` check is required on `main`.

The release that carries C2-0 to C2-5 is **0.10.0**: its changelog section is
written, and the tag is cut through `release.yml` once Kyle authorizes it. Until
then the only published image, 0.9.0, predates every fix in this track.

### W. Wave 6: the suite (specced 2026-09-24)

Cloud City will run Cloud Codex beside Cloud Command as one suite (working name
"Cloud City"). Kyle's decisions of 2026-09-24, recorded in the Cloud Command ADR
`wave-6-is-one-sign-in-events-and-a-shared-shell.md`, set the scope and the order:

- **Scope before a test deploy:** one sign-in for both products at Cloud City ID
  (a Zitadel issuer, with both products as OIDC relying parties) and one
  sign-out; events Cloud Codex emits and Cloud Command consumes, so document
  changes show on tasks; and a shared suite shell, with Cloud Codex on Cloud
  Command's design tokens.
- **Order:** Wave 6, then a single-EC2 test deploy of both products and Cloud
  City ID that Kyle performs himself, then the design-partner beta, then a
  containerized service for real users and the commercial work. This replaces
  the earlier "unification after the beta" framing.
- **Shape:** every Cloud Command workspace maps to exactly one Cloud Codex
  instance. Cloud Codex keeps its per-instance integer ids; Cloud Command mints
  the instance id. There is no organization above a workspace.

Like track S this is not justified by adoption, and it carries one constraint
through every sub-track: **everything new is generic and off by default.** An
install that sets no new variable (no OIDC issuer, no webhook subscription, no
suite mode) behaves as it does today, so Cloud Codex stays source-available and
complete on its own.

**IDs are fresh.** `W6-CDX-n` are this repository's sessions and never collide
with the shipped C2-0 to C2-5. `W6-CMD-n` are Cloud Command sessions and
`W6-CCID-n` are sessions in Cloud City ID's own repository; both appear here
only as dependencies. The 2026-08-24 design's C2-AUTH, F and CC numbers are
retired.

| Sub-track | Spec | Plan | Sessions |
|---|---|---|---|
| Identity | [suite identity](2026-09-24-suite-identity.md) | [plan](../plans/2026-09-24-suite-identity.md) | W6-CDX-10 (shared), W6-CDX-2 to W6-CDX-9 |
| Outbound events | [outbound events](2026-09-24-outbound-events.md) | [plan](../plans/2026-09-24-outbound-events.md) | W6-CDX-12 to W6-CDX-16 |
| UI and tokens | [suite UI](2026-09-24-suite-ui.md) | [plan](../plans/2026-09-24-suite-ui.md) | W6-CDX-21 to W6-CDX-29 |
| Hosting readiness | [suite hosting readiness](2026-09-24-suite-hosting-readiness.md) | [plan](../plans/2026-09-24-suite-hosting-readiness.md) | W6-CDX-31 to W6-CDX-36 |

W6-CDX-1, W6-CDX-11 and W6-CDX-20 (the three "write the spec" sessions) and the
documents half of W6-CDX-30 are the PR that added this section. W6-CDX-30's
other half, the live-MySQL test project, is the same work as W6-CDX-10 and is
done once, as W6-CDX-10.

Every session, in the order to do them. "Deploy" marks the sessions the test
deploy needs; the rest are inside Wave 6 and may land after it.

| ID | Session | Depends on | Deploy |
|---|---|---|---|
| W6-CDX-10 | A live-MySQL integration test project | nothing | yes |
| W6-CDX-2 | One session per sign-in, stored hashed | W6-CDX-10 | yes |
| W6-CDX-3 | A `__Host-` cookie, and Origin-required cookie writes | W6-CDX-2 | yes |
| W6-CDX-4 | An identity-resolution seam, Google moved onto it | nothing | yes |
| W6-CDX-5 | The OIDC relying party and `user_identities` | W6-CDX-2, W6-CDX-4; W6-CCID-1, W6-CCID-2, W6-CCID-3 | yes |
| W6-CDX-6 | Sign-out that propagates | W6-CDX-5 | yes |
| W6-CDX-7 | Machine JWTs through `verifyMachineCredential` | W6-CDX-5 | yes |
| W6-CDX-8 | Hosted mode: OIDC only, invitations bind on verified email | W6-CDX-5 | yes |
| W6-CDX-9 | Machine membership endpoints (**contingent**) | W6-CDX-7, W6-CDX-8 | Kyle's call |
| W6-CDX-12 | Three activity gaps fixed at the source | W6-CDX-10 | yes |
| W6-CDX-13 | The outbox, subscriptions and the emit hook | W6-CDX-12 | yes |
| W6-CDX-14 | The delivery worker | W6-CDX-13 | yes |
| W6-CDX-15 | Webhooks in the admin console | W6-CDX-14 | no |
| W6-CDX-16 | A machine read for reconciliation | W6-CDX-10 | no |
| W6-CDX-21 | Vendor the tokens, fonts and gates | W6-CMD-20, W6-CMD-21 | yes |
| W6-CDX-22 | The palette bridge and the accent picker | W6-CDX-21 | yes |
| W6-CDX-23 | Focus, buttons and the Toast | W6-CDX-22 | yes |
| W6-CDX-24 | Dialogs with real semantics | W6-CDX-23 | yes |
| W6-CDX-25 | Shell chrome and the suite identity cluster | W6-CDX-23, W6-CMD-23 | yes |
| W6-CDX-26 | The suite front door, deep links in | W6-CDX-24, W6-CDX-25, W6-CDX-8, W6-CMD-24 | yes |
| W6-CDX-27 | Deep links out: Linked tasks | W6-CDX-25, W6-CMD-25 | yes |
| W6-CDX-28 | Content surfaces on the tokens | W6-CDX-22 | the cut line |
| W6-CDX-29 | Admin and settings surfaces, and the UI track retires | W6-CDX-26, W6-CDX-27, W6-CDX-28 | the cut line |
| W6-CDX-31 | Signals, health, readiness, the single-writer lock | W6-CDX-10 | yes |
| W6-CDX-32 | Production configuration and the per-instance contract | W6-CDX-10 | yes |
| W6-CDX-33 | The grant recipe and the isolation proof | W6-CDX-32 | before a second instance |
| W6-CDX-34 | Document images for readers only | W6-CDX-10 | yes |
| W6-CDX-35 | Backup and restore, with a drill | W6-CDX-31 | yes |
| W6-CDX-36 | The Wave 6 Codex release the test box pins | the deploy-path sessions above | yes |

Two releases, deliberately separate: **0.10.0** carries C2-0 to C2-5 and
exists so the published image stops predating the security fixes; **W6-CDX-36**
is the later release that contains this wave, and it is what the test box pins.

**Deferred to the later containerized-service era, and not planned here:**
billing, entitlements, the seat taxonomy, hosted per-customer provisioning
automation, and operator access for Cloud City staff. Each spec lists the
narrower items it defers and why.

**Open questions for Kyle** live in each spec, and the ones that move a session
are: whether membership sync to a Codex instance is needed before the test
deploy (W6-CDX-9), whether a 24-hour ceiling on SSO sessions is acceptable,
where the shared token package lives and whether Codex's palette may change,
the test box's host names, and how many instances the beta must carry.

## Sequencing

```
now         A ────────────────────────────► shipped
                    │
                    ├──► D  (cheap, parallel, compounds with A)
                    │
                    └──► B ────────────────► shipped
                              │
                    E ────────┘  E1 defects shipped 2026-08-09; E2 extraction open

            C: decided 2026-08-08, no breaking change to execute

            S ────────────────────────────► shipped 2026-09-12 ──► 0.10.0
                                                  │
            W ◄───────────────────────────────────┘  specced 2026-09-24
                W6-CDX-10 first, then identity, events, UI and hosting
                in parallel, then W6-CDX-36, the release the test box pins
```

Track S ran alongside the rest rather than after them. It did not depend on
A through E and they did not depend on it, but C2-0 was a hard gate inside S: it
made a red CI run block a merge, and the PRs that followed it changed access
control and the credential reset path.

Track W builds on S (the migration runner, the machine-credential seam and the
reader check are all load-bearing for it) and depends on nothing in A to E. Its
first session is W6-CDX-10, because no Wave 6 schema change can be verified
until a test touches a real MySQL; after that its four sub-tracks can run in
parallel, subject to the cross-repo dependencies each spec names. Its size, 29
sessions in this repository with one active committer, is the reason each spec
marks which sessions the test deploy needs and which may trail it.

A, B and D have shipped, C is decided, and **E's defect half shipped on
2026-08-09**. Two of the arguments for E were settled during D rather than
deferred into it: the editor no longer blanks the app on navigation, and the
app now has an error boundary, so a render error is no longer unrecoverable.

What remains is **E2**, breaking up `Editor.jsx` and `GitHubPage.jsx` (2652
lines) so the interface is testable; its first cut landed 2026-08-10 and took
`Editor.jsx` to 1332 lines. B13 shipped on 2026-08-09 and **B15** (glyph-only
control names) on 2026-08-20, so no accessibility item from the defect list is
open.

The measurement re-read on 2026-08-09, one day after the v0.9.0 release: still
38 stars, 1 fork, 0 open issues, 0 watchers, 12 unique viewers and 66 unique
cloners in 14 days. Too early to read anything into it, but it is why the
defect half was done first: with no inbound signal to prioritise by, the work
that could actually bite whoever pulls the image outranks the work that only
makes the next change cheaper.
