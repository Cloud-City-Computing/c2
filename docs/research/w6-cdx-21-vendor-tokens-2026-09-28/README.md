# W6-CDX-21: vendoring the design package, and what the first gate run found

Session W6-CDX-21 of the suite UI track (`docs/plans/2026-09-24-suite-ui.md`, PR 1),
2026-09-28, branch `track/w6-cdx-21-vendor-tokens`. This folder is the evidence: the
before and after captures, the computed-style probes behind them, the contrast matrix, the
ledger's first buckets and the seeded mutations.

## Provenance of the vendored copy

`cloudcodex/vendor/cloud-city-design/` is `Cloud-City-Computing/cloud-city-design` at
`2d52baaadc755a724ffb1245b2d85a62ffb0bc0b` (package 0.2.0, the merge of its PR #2). Before
copying: the checkout was clean, the commit is an ancestor of upstream `main`, all 37 files
the upstream `MANIFEST.json` lists matched their SHA-256, and `node --test` passed 53 of 53.
The copy is exactly those 37 files, each `cmp`-identical, plus the consumer `MANIFEST.json`
(upstream's with an `upstream` block). The package's own suites pass 53 of 53 inside the
copy too, and `tests/design/vendored.test.js` reruns them on every `npm test`.

## What the gates measured on main

- **Token discipline: 745 findings**, the Wave 6 research's number exactly (646 literal
  colours, 77 accent fill shades in text or edge positions, 22 suppressed outlines), over 68
  files (69 once `src/codex.css` exists). `raw/ledger-report.txt` is every bucket.
- **Dangling references: 12 sites, not 10.** The spec counted ten; the vendored gate lists
  twelve at `91493a6` and at today's `main` alike (11 in `index.css`, 1 in
  `ArchiveBrowser.jsx`). Two are a false positive (`--swatch-color`, which
  `AccountMenu.jsx` sets per swatch in an inline style the gate cannot see), so ten are live.
  The red run is `raw/red-design-run.txt`.

## The ten live references, and what each fix looks like

The plan named `.btn-oauth`'s three and Draw.io's two. The other five had the same cause and
a plain intent, so they are fixed here rather than ledgered:

| Rule | Was | Now | Visible change |
|---|---|---|---|
| `.btn-oauth` | `--border-main`, `--bg-surface`, `--text-main` | `--border-color`, `--bg-panel`, `--text-primary` | the Google button gains a 1px border and a panel background |
| `.oauth-divider::before/::after` | `--border-main` | `--border-color` | the "or" divider gains its two lines |
| `.linked-account-row` | `--border-main`, `--bg-surface` | `--border-color`, `--bg-panel` | Account, Linked Accounts: each row gains a border and background |
| `.drawio-block__delete-btn:hover` | `--red` twice | `--color-danger` | the hovered delete button is red, not transparent with a white edge |
| ArchiveBrowser access tabs | `--accent` | `--brand-blue` | the active tab (Users) gets its 2px accent underline |
| `.avatar-upload__placeholder` | `--bg-secondary` | declaration removed | none: it never applied. Rebinding it to `--bg-hover`, the preview's own surface, moved a one-pixel antialiased ring, so the dead line was deleted instead |

## Before and after

`raw/capture.mjs` drives a headless Chromium over CDP against the production build served by
`node server.js` (`NODE_ENV=production`, a throwaway MySQL 8.4.11 with `init.sql` and
`seed.sql`, Google and GitHub sign-in configured with dummy credentials so their buttons
render), signed out and then as the seed user `alice`, at 1280x800 and 390x844. The first-run
welcome dialog is dismissed on each load. It writes a PNG per view and `probes.json`, the
computed styles of every element the fixes touch. `raw/pixel-diff.py` compares the two sets.

| View | Changed pixels | Why |
|---|---|---|
| home, desktop and phone | 0 | |
| Account, top (avatar placeholder), both widths | 0 | the removed declaration never applied |
| login dialog, both widths | 26,800 / 21,637 | the divider lines, the Google button's border and background, and the dialog 2px taller for that border |
| Account, Linked Accounts, both widths | 100,877 / 56,520 | the rows' borders and backgrounds, and everything below them 2px lower per row |
| Manage Archive Access, both widths | 395 / 391 | the Users tab underline only |
| editor, draw.io delete hovered (desktop only: the editor is desktop-only) | 976 | the red hover, plus the presence dot, whose colour is picked per connection |

Every image was read. The probes confirm the rest: `<html>` carries `data-theme="dark"`, six
font faces are registered and none loaded (nothing sets Inter or Poppins yet), and the body
font is still `system-ui, Avenir, Helvetica, Arial, sans-serif`.

## `src/codex.css`, measured

The surfaces are Codex's five steps with Cloud Command's blue-grey tint (chroma 0.014, hue
240), each at the three-decimal lightness nearest the grey it replaces: `#242424` at L 0.26,
`#1e1e1e` at 0.234, `#2e2e2e` at 0.301, `#3a3a3a` at 0.348 and `#444444` at 0.386, each within
1.002:1 of that grey. `raw/contrast-matrix.txt` is every pair; the tightest are faint text on
the strongest hover at 4.70:1 and the accent there at 4.97:1. Faint is
`oklch(0.77 0.005 240)` because 0.76 clears 4.5:1 by only about 0.02.

## Two things the plan did not foresee

- **Vite stripped the package's licence notice.** Vite's resolved esbuild options default to
  `legalComments: 'none'`, so the `/*!` header of `core.css` vanished from the minified
  stylesheet even though it was imported first (esbuild alone keeps it; the unminified build
  keeps it). `vite.config.js` now sets `esbuild.legalComments: 'inline'`, measured at +333
  bytes of CSS, and the vendor chunks keep their own licence headers too (React's are the
  largest, about 2 KB).
- **`core.css` names `--font-mono`, which `index.css` already read with a fallback** in two
  GitHub-page rules. They now get the package's stack. On this Linux box both stacks resolve
  to the same face (checked by rendering both). macOS and Windows were not checked: there the
  new stack may pick Menlo or Consolas where the old one fell to the browser's generic
  monospace face.

## Mutations

`raw/mutate.py` seeds each, checks it landed, runs the `design` project, restores it with
`git checkout`, and checks the tree is clean; `raw/mutations.txt` is its output. All fifteen
turned the named test red. The last two were added after review: a literal colour on a plain
property inside `codex.css`'s dark block (the literal rule had skipped the whole file; it now
skips only custom-property declarations, and `codex-css.test.js` pins that the file declares
nothing else), and `NODE_OPTIONS` passed through to the package suites (their summary is read
as TAP, which is Node 20 and 22's default when piped but not Node 24's; the run now names the
TAP reporter and drops `NODE_OPTIONS`, and the design project passes under `node:24-slim`,
v24.21.0, where the earlier version failed with `NaN`). The first attempt at the `.jsx` hex put it inside `Toast.jsx`'s doc
comment (the first occurrence of "import" in the file is in its usage note), where the
scanner correctly ignores it and nothing went red; the seed was moved into code.
