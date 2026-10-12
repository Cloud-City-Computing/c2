# Plan: suite UI alignment track

Implements [`../specs/2026-10-11-suite-ui-alignment.md`](../specs/2026-10-11-suite-ui-alignment.md).

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to
> implement this plan task by task, one fresh subagent per task, with review between tasks. This is
> the standing convention for a written plan in this repo (`docs/plans/README.md`), not a choice to
> re-present. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloud Codex reads as one family with its sibling product: the suite shell pattern (a
sidebar-led layout, page headers, a two-row phone strip), the shared controls, the content surfaces,
a light theme including a colour-only pass over the deferred editor, comments and GitHub surface, and
one suite-wide theme and accent preference that both products honour.

**Architecture:** `src/codex.css` holds three blocks: `[data-theme]` for bindings that never change
with the theme, `[data-theme='dark']` and `[data-theme='light']`, plus two `[data-accent]` blocks
that derive the accent steps from a hue. `tests/design/suite-theme.json` restates the spec's token
table and `codex.css` must equal it. The theme and accent are resolved before first paint by an
inline script whose SHA-256 is in production's `script-src`, and read, written and kept in step by
one module, `src/lib/suite-prefs.js`, that implements the spec's suite preference contract.
`Std_Layout.jsx` becomes the sidebar-led shell with a shared page header component.

**Tech stack:** React 19, Vite 7, plain CSS custom properties in OKLCH, Vitest 4 + jsdom, the
vendored `cloud-city-design` gates, Playwright or `iris` for captures.

**Preconditions:** this plan's spec and plan PR (W6-CDX-37) has merged. PR 3 also waits for
`fix/suite-switcher-and-dead-session` to merge, and rebases on it. Nothing waits on the sibling
product: the targets are written in the spec.

**Order:** one PR per session. Every PR is on the release path: W6-CDX-36 waits on PR 7.

| PR | Session | Needs first | Branch |
|---|---|---|---|
| 1 | W6-CDX-38, neutrals, base and the hover model | W6-CDX-37 | `track/w6-cdx-38-neutrals` |
| 2 | W6-CDX-39, controls, the Toast and dialog panels | PR 1 | `track/w6-cdx-39-controls` |
| 3 | W6-CDX-40, the suite shell | PR 2, `fix/suite-switcher-and-dead-session` | `track/w6-cdx-40-shell` |
| 4 | W6-CDX-41, lists, home and the document header | PR 3 | `track/w6-cdx-41-lists` |
| 5 | W6-CDX-42, settings, admin, not-found and first run | PR 3 | `track/w6-cdx-42-settings-admin` |
| 6 | W6-CDX-43, the light theme and the hue-based picker | PRs 4 and 5 | `track/w6-cdx-43-light` |
| 7 | W6-CDX-44, the theme switch and the suite preference contract; the track retires | PR 6 | `track/w6-cdx-44-theme-switch` |

## Before every PR

- [ ] `git fetch origin && git switch -c <branch> origin/main`; re-derive every anchor by name, never
      by shifting a line number.
- [ ] `cd cloudcodex && npm ci && npx vitest run --project design 2>&1 | tail -5`, and record the
      ledger total from `node tests/design/report.mjs src/index.css | tail -1`.
- [ ] **Captures before the change**, at 1280x860 and 390x844, dark (and light from PR 6 on), of
      every route the PR touches, into `docs/research/<branch-topic>-<date>/before/`. Use `iris shoot`
      where it can set the viewport and colour scheme; otherwise a Playwright script kept beside the
      captures (`capture.mjs`), which signs in through a local dev instance's own login. A person
      opens and reads every image; `iris`'s `pass` means only "not blank and nothing threw".
- [ ] **No capture of the sibling product goes into this repository**, and no code from it. A
      comparison with the suite shell pattern is described in words in the PR body, against the
      spec's written anatomy.
- [ ] Before `gh pr create`: an adversarial review (the `momus` reviewer); then CI to green.

## Global constraints

The identity plan's global constraints apply. In addition:

- **No `position`, `overflow`, `transform`, width or height change on or around `.editor-container`
  or `.tiptap`,** and no change to the content column's width on the document page at 1280. Every
  comment highlight and remote cursor is positioned against them, with no test coverage. A container
  may move (an offset is safe: `CommentHighlights.jsx:98` and `RemoteCursors.jsx:46` compute against
  the container); it may not resize.
- **The two-cursor smoke** (PRs 1, 3, 4 and 6): a document open in two signed-in browsers with one
  comment, captured before and after; the highlight sits on its text and both cursors sit on their
  characters. Record it in the PR's research folder.
- **The vendored directory is never edited here.** A primitive that should change is a package PR
  upstream, then a re-vendor PR here.
- **Class names are kept on a restyle.** A rebuilt surface rewrites its tests in the same PR, tests
  first.
- **Suite mode off** keeps everything that names the suite out of the page, pinned by a render test in
  every PR that touches the shell.
- **The CI mirror** before every push, from `cloudcodex/`:
  `npm audit --omit=dev --audit-level=moderate && npm run lint && npm test && npm run test:coverage && npm run build`.

---

## PR 1: W6-CDX-38, neutrals, base and the hover model

**Deviations, recorded at execution (W6-CDX-38, 2026-10-11).** The plan is the approval; each of these is a
place where the code proved a step wrong, or a step needed a choice the plan did not spell out.

1. **The danger family moved into this PR.** The fixture's `--cx-danger-fill` is `var(--danger-bright)`, and a
   white label on that fill measures well under 4.5:1. So the fill, its label (`--cx-on-danger` is now the dark
   ink, `--cx-on-accent`), and the hover (an inset ring on the same fill, `--cx-danger-fill-hover` and `-press` both
   equal the fill) changed together. W6-CDX-39's danger item (Task 2.2) is therefore already done here, and
   `painted.test.js` pins the new model.
2. **The hover on a row inside a panel is `--cx-surface-1`, not a border colour.** The plan's rule ("on a card or
   panel, `border-color` strong") gives a row with no border no hover feedback at all. Rows and items inside a
   panel or popover (the mention picker, the notification and search dropdowns, settings and permission rows,
   the export menu, the admin table rows) take the sunken well. Only the two elements that already draw a 1 px
   border take `--cx-border-strong` on hover: `.btn-oauth` and `.tfa-method-option`.
3. **X4 is `font-family: inherit`, not `font: inherit`.** The shorthand also resets size and line height: it grew
   the top-bar search field from 31px to 36px in a geometry probe of the document page (before and after).
   The family alone moves the search field by 1px and the buttons' widths by 1 to 2px, which is the typeface
   change X4 asks for. `control-font.test.js` pins the family.
4. **The eleven undeclared fallback names read a `--cx-` token, not a bridged name.** `--bg-primary`, `--text`,
   `--accent`, `--border-subtle`, `--accent-hover`, `--accent-rgb`, `--surface-alt`, `--bg-color`,
   `--surface-color`, `--color-accent-alpha` and `--accent-red` each map to the token the fallback meant. One
   visible change follows: the GitHub banner's `--accent` fallback was `#7c3aed` (violet) and now paints the
   picked accent. Declared names lose their fallback literals (they never painted), which is why the ledger fell
   by 212 (399 to 187) and no bucket rose.
5. **Labels on a danger tint step to `--cx-danger-bright`.** `.panel-status.error`, `.ci-badge--failure`,
   `.gh-reconnect-banner`, `.log-tree-delete:hover` and the ghost danger hover measured 4.24 to 4.46:1 on the new
   surfaces with the status step. The bright step is the one the tint rules were written for (W6-CDX-28).
6. **The shared `[data-theme]` block reaches the vendored parser through `THEME_OPTIONS`** (`tests/design/buckets.js`).
   The parser files only `:root` selectors as base, so without the option the shared tokens (`--cx-white`,
   `--cx-transition`, the layout sizes) resolve to nothing in the bridge and contrast tests.
7. **`--cx-accent` is `--accent-400` (the fixture), not `--accent-300`.** Every text pair still clears 4.5:1 on the
   four surfaces (`contrast.test.js` is green), and the eight picker hues still clear it on each surface
   (`accents.test.js`, 32 of 32).
8. **Two-cursor smoke: not run.** It needs two signed-in browsers and a comment on the document. What was measured
   instead is the document page's geometry before and after (the content column, the header, the archive view and
   every control's box, at 1280 and 390): the only movement is the typeface change in item 3. The editor canvas is
   not on the read-only page, so the editor's own geometry is covered by the colour-only diff, not by a probe.
10. **A ghost hover is the sunken step, `--cx-surface-1`.** A surface-2 hover vanished inside a dialog (the panel
    is surface-2), so the ghost hover now differs from both the page (surface-0) and a dialog panel (surface-2).
    `ghost-hover.test.js` pins both.
11. **The deferred families keep Codex's own radii (4, 8, 12px) through `--cx-deferred-radius-*`** until W6-CDX-43.
    K3 allows no geometry change there, and core's steps (6, 10, 14px) would have moved the comments, the editor,
    Draw.io, Version History and the GitHub banners. The alias sits in codex.css's shared block, and every
    `var(--radius-*)` read inside those banners now reads it (25 reads). `deferred-radius.test.js` pins both.
12. **The font inherit rule excludes the deferred families.** Measured in edit mode on the document page, before
    and after: the editor container, the editor, the toolbar and every toolbar button sit at identical boxes, and
    the toolbar buttons keep the browser font. The rule therefore excludes `.comment-manager`, `.comment-thread`,
    `.editor-container`, `.tiptap-toolbar`, `.editor-toolbar`, `.markdown-editor`, `.version-history`, `.drawio-block`,
    `.document-readonly`, `.editor-log`, `.editor-with-comments`, the comment textarea, and every `gh-` element and
    its descendants. `control-font.test.js` pins the exclusion.
13. **The top bar was already opaque, so nothing changed there.** A scrolled capture showed the card's meta line
    cut at the bar's lower edge; pixel samples of the bar band (y 40 to 52) match the bar's own colour, and the
    computed background has alpha 1. `topbar.test.js` pins the opaque background as a guard.
9. **The mutation note.** Lifting `--cx-surface-2` to `oklch(0.24 0.014 240)` turns `--cx-text-faint` on
   `--cx-surface-2` red in `contrast.test.js` (it measures under 4.5:1); the mutation landed (the file was checked
   for the new value) and was restored (`cmp` against the saved copy).


### Task 1.1 The fixture, and a test that holds `codex.css` to it

- [x] Create `cloudcodex/tests/design/suite-theme.json` with the spec's token table, dark column only
      for now:

```json
{
  "_rule": "The suite pattern's theme values, restated from docs/specs/2026-10-11-suite-ui-alignment.md. src/codex.css must equal this file; a change here is a change to the suite pattern, made in both products.",
  "dark": {
    "--cx-surface-0": "oklch(0.17 0.012 240)",
    "--cx-surface-1": "oklch(0.145 0.012 240)",
    "--cx-surface-2": "oklch(0.21 0.014 240)",
    "--cx-border": "oklch(0.3 0.015 240)",
    "--cx-border-strong": "oklch(0.38 0.016 240)",
    "--cx-text-primary": "oklch(0.93 0.005 230)",
    "--cx-text-secondary": "oklch(0.72 0.01 235)",
    "--cx-text-faint": "oklch(0.61 0.012 238)",
    "--cx-accent": "var(--accent-400)",
    "--cx-accent-hover": "var(--accent-300)",
    "--cx-accent-fill": "var(--accent-400)",
    "--cx-on-accent": "oklch(0.14 0.03 240)",
    "--cx-select-wash": "oklch(0.21 0.055 240)",
    "--cx-danger": "var(--danger-bright)",
    "--cx-success": "var(--success-bright)",
    "--cx-warning": "var(--warning-bright)",
    "--cx-info": "var(--accent-400)",
    "--cx-danger-fill": "var(--danger-bright)",
    "--cx-scrim": "oklch(0.12 0.02 240 / 0.5)",
    "--cx-shadow-sm": "0 1px 2px oklch(0 0 0 / 0.3)",
    "--cx-shadow-md": "0 4px 16px oklch(0 0 0 / 0.4)",
    "--cx-focus-ring": "var(--cx-accent)"
  }
}
```

- [x] `tests/design/suite-theme.test.js`: parse `src/codex.css` with the same block reader
      `codex-css.test.js` uses; for each theme key in the fixture, every name equals its declaration in
      that theme's block. Run it: **expected** red on every row (the values have not moved yet).

### Task 1.2 The gates for the new shape, red first

- [x] `codex-css.test.js`: replace "declares everything under the dark theme attribute" with "declares
      under exactly `[data-theme]` and `[data-theme='dark']`"; add "declares no `--cx-radius-*`,
      `--cx-surface-3` or `--cx-surface-4`". **Expected:** red.
- [x] `bridge.test.js`: `--bg-hover` and `--bg-hover-strong` are gone from the bridge; `--radius-sm`,
      `-md` and `-lg` are not redeclared by `index.css` (core's values apply). **Expected:** red.
- [x] `contrast.test.js` with `pairs.json`: surfaces become `--cx-surface-0`, `-1`, `-2` and
      `--cx-select-wash`; add a mutation note in the PR that lifting `--cx-text-faint` onto a
      `oklch(0.24 0.014 240)` surface turns it red (computed 4.34:1), confirmed to have landed.
- [x] `tests/design/hover-fills.test.js`: no rule outside the editor, comments and GitHub banners
      reads `var(--bg-hover)` or `var(--bg-hover-strong)` (use `buckets.js` for the banner of each
      line). **Expected:** red, 29 sites at `f0bc965`, some inside the deferred banners; the test
      reports each.
- [x] A frontend test that `index.css` declares `font: inherit` for `.btn`, `button`, `input`,
      `select` and `textarea` (declaration-level: jsdom does not substitute `var()`). **Expected:** red.

### Task 1.3 The values

- [x] `codex.css`: move the Google brand colours, `--cx-white`, `--cx-ink-deep`, the layout sizes and
      `--cx-transition` into a bare `[data-theme]` block; set the dark block to the fixture; add
      `color-scheme: dark;` to the dark block (the contrast parser ignores a non-custom property; check
      `codex-css.test.js`'s "custom properties and nothing else" rule and allow exactly
      `color-scheme`). Delete `--cx-radius-*` and the bridge's three `--radius-*` lines.
- [x] `--cx-border` (123 uses through `--border-color`): each use on a control (inputs, selects,
      buttons, the switcher) moves to `--cx-border-strong`; cards and dividers keep `--cx-border`. List
      the moved selectors in the PR body.
- [x] Re-measure every pair: `npx vitest run --project design`. **Expected:** green, the ledger total
      unchanged or lower, never higher.

### Task 1.4 The hover model

- [x] For each site `hover-fills.test.js` reports: on a row whose resting background is sunken or the
      page, the hover becomes `var(--cx-surface-2)`; on a card or panel, the hover becomes
      `border-color: var(--cx-border-strong)` and the background does not change. Inside the deferred
      banners, the hover keeps a fill but binds to `--cx-surface-2` (colour only, no geometry).
- [x] Delete `--cx-surface-3`, `--cx-surface-4`, `--bg-hover` and `--bg-hover-strong`. **Expected:**
      `hover-fills.test.js`, `bridge.test.js` and `codex-css.test.js` green.

### Task 1.5 Undeclared fallbacks, and the font

- [x] `node -e` or `git grep -n -E "var\(--[a-z-]+, *[#a-z0-9(]" -- cloudcodex/src` lists the
      fallback-carrying reads; for each of the 13 undeclared names, declare it in the bridge onto a
      `--cx-` token, or replace the read. `--editor-font-size` and `--density-scale` are set by script
      and stay (density goes in PR 5). **Expected:** `dangling.test.js` green, and a new assertion
      that no fallback literal is a colour.
- [x] `index.css`: `font: inherit` on the five selectors (X4).

### Task 1.6 Look, and the smoke

- [x] Captures of home, an archive, a document, Account and Admin at both widths, dark, before and
      after; the two-cursor smoke. The PR body says plainly that every screen darkens a step and the
      text tiers spread, and why.

---

## PR 2: W6-CDX-39, controls, the Toast and dialog panels

**Deviations, recorded at execution (W6-CDX-39, 2026-10-11), and the momus round-one fixes.** The plan is the approval;
each of these is a place where the code proved a step wrong, or the session needed a choice the plan did not spell out.

1. **The danger item (Task 2.2) was already done in A1** (W6-CDX-38, PR 1 deviation 1). This session pins it.
2. **The primary's hover is the lighter accent step (`--cx-accent-hover`).** At rest and on hover it resolved to the same
   colour, so there was no hover at all. The rest fill keeps the `--brand-blue-hover` name, which resolves to
   `--cx-accent-fill`, because eight other sites read that name.
3. **The button's height is a minimum (`min-height: 30px`, the small size 26 px), not a fixed height.** A label that wraps
   or grows must not be clipped at 320 or 390 px. The measurement is in the research folder's README.
4. **The `.btn` anatomy is scoped with the X4 exclusion; `.btn.btn-sm:not(...)` restates the small size** at a higher
   specificity, so the 101 `.btn-sm` uses keep their size.
5. **The Menu is single-choice, so its items are `menuitemradio` with `aria-checked`.** The trigger's accessible name is
   "label: visible choice" (WCAG 2.5.3). Typing a letter jumps to the next item starting with it. Tab and Escape close the
   menu and return focus to the trigger; inside an aria-modal dialog that holds the dialog's focus trap.
6. **The popup lives in its own `#menu-root`, never in `#dropdown-root`** (showDropdownMenu hides and clears that node, so
   a menu opened after the account panel was dismissed was invisible). Inside an aria-modal dialog it is portalled into
   that dialog, so the dialog's focus trap and the accessibility tree reach it.
7. **The popup follows the trigger on scroll (capture phase) and resize.**
8. **The field primitive is on the search, the sort and the Account panels' fields** (`.field__control`, with `.field` and
   `.field__label` on the Account pairs). Other inputs in the app keep their markup until their session.
9. **The icon button (`.btn-icon`, 30 px box, 44 px hit area through `::before`) is on the dialog close buttons, the toast
   dismiss and the search clear.** The GitHub family's close button is excluded (deferred).
10. **The tabs are real `.tabs` and `.tabs__tab` classes** on the Notifications and Activity filter rows; the page classes
    stay on the same elements. **The chip is a real `.chip`** on the admin role and invitation statuses and the owner role
    in Workspaces.
11. **Emoji and symbol glyphs in PR 2 scope are replaced by `icons.jsx`**: the toast's status marks, the favourite stars,
    the Account warning, the archive comment count and Login's rule marks. **Moved, with reasons:** the admin console's
    emoji and tick marks (its nav and stats are rebuilt as the tab row in PR 5, W6-CDX-42, and its tests are rewritten there);
    the document header's and the export menu's emoji (PR 4, W6-CDX-41, the header is rebuilt there; the editor's own
    toolbar glyphs are in the deferred families); the GitHub and draw.io glyphs (deferred, UI-later). The shell has no emoji at
    this commit, so PR 3 has nothing to replace.
12. **The destructive copy is one module, `src/lib/destructive-copy.js`,** with each sentence checked against the delete it
    confirms (the FK actions in `init.sql` and the route's statement). Corrections found on the way: the workspace delete
    said its archives and logs go, but they stay with no squad (`archives.squad_id` is SET NULL and the admin and owner routes
    delete only the workspace row); the user delete now names the sessions, comments, favorites and memberships that go and
    the documents that stay with no author. The repository removal names only the link.
13. **The two-cursor smoke is not run** (it needs two signed-in browsers). The editor's geometry is measured instead
    (`docs/research/w6-cdx-39-controls-2026-10-11/`).
14. **The phone toast overlaps the bottom tab bar** until PR 3 removes that bar.
15. **Activity and notification avatars are keyed on the actor id** (`user_id`, `actor_id`), so two users with one name keep
    their own tints.
16. **The admin toast uses the server's message only when the error has a status** (an API error); a network failure shows the
    fallback copy (`adminToast` in AdminPage).

### Task 2.1 The Toast, tests first (X2, X3, X10)

- [x] `tests/src/components/Toast.test.jsx`, new cases:

```jsx
it('shows the first toast after a fresh load', async () => {
  vi.resetModules();
  const { showToast } = await import('../../../src/components/Toast.jsx');
  act(() => { showToast('First', 'info'); });
  expect(await screen.findByText('First')).toBeInTheDocument();
});

it('shows a string passed to toastError as the message', async () => {
  const { toastError } = await import('../../../src/components/Toast.jsx');
  act(() => { toastError('Could not revoke the invitation.'); });
  expect(await screen.findByText('Could not revoke the invitation.')).toBeInTheDocument();
});
```

      **Expected:** the first is red at `f0bc965` (the container's effect has not assigned
      `addToastFn` when `showToast` calls it), the second red (a string has no `.body`).
- [x] Fix: `showToast` queues the toast when the container is not ready, and the container's effect
      drains the queue on mount; `toastError` treats a string argument as the message. In
      `AdminPage.jsx` (`:329`, `:385`, `:823`) pass the error itself, so a server message with
      `status` survives. An `AdminPage` test: a failing revoke whose body says "Could not revoke the
      invitation. Try again in a moment." shows exactly that.
- [x] The stack at the bottom right; the message in `--cx-text-primary`; the status on the icon and
      the edge; a `.toast--info` rule. `aria-live` and `role="alert"` stay pinned.

### Task 2.2 Buttons

- [x] `.btn` and its variants (`index.css`, the Buttons banner) on the spec's anatomy, class names
      kept: `height: 30px; padding: 0 var(--space-3); border-radius: var(--radius-md); font: 500
      var(--text-sm)/1 var(--font-ui); letter-spacing: normal;`. Danger: `background:
      var(--cx-danger-fill); color: var(--cx-on-accent);` and on hover `box-shadow: inset 0 0 0 1px
      var(--cx-text-primary)`. Icon buttons 30 px with a 44 px hit area (a `::before` inset of -7px).
- [x] `painted.test.js`: the danger label on `--cx-danger-fill` at 4.5:1 (computed 5.06). The Buttons
      banner has zero findings.

### Task 2.3 Fields, selects and the menu primitive

- [x] `src/components/Menu.jsx`: a trigger button with `aria-haspopup="menu"` and `aria-expanded`, named "label: visible
      choice"; a `role="menu"` list of `role="menuitemradio"` buttons with `aria-checked` (role note: every Menu is single-choice;
      an action menu would use `menuitem`); arrow keys, Home and End, a letter jumps to the next match; Escape and Tab close it
      and return focus to the trigger; an outside click closes it; placed in its own `#menu-root`, or in the aria-modal dialog it
      is in, at `--z-menu`; it follows the trigger on scroll and resize; no scrim.
- [x] One field primitive in CSS (`.field`, `.field__label`, `.field__hint`, `.field__error`); the
      search filters, the sort control, the invite dialog's squad and role, and the Account panels use
      it. The sort, squad and role native selects become `Menu` triggers.
- [x] The export menu and the GitHub sync menu adopt the menu's look (the GitHub surface: colour and
      class only, no layout change).

### Task 2.4 Tabs, chips, avatars, icons

- [x] `.tabs` (Activity, Notifications; Admin uses it in PR 5); chips; an `Avatar` component on
      `--avatar-1..8` from a stable hash of the user id with dark initials; one stroke icon set
      (`src/components/icons.jsx`) for every shell and content icon outside the editor canvas.

### Task 2.5 Dialog panels, and verify

- [x] `.modal-content-wrapper` and `ConfirmDialog` on the panel tokens; destructive copy names what is
      lost. Lint, test, coverage, build. Captures of each control family on real screens, both widths,
      dark.

---

## PR 3: W6-CDX-40, the suite shell


**Deviations, recorded at execution (W6-CDX-40, 2026-10-12).** The plan is the approval; each is a place where the code,
or Kyle's binding decisions, required a choice the plan did not spell out.

1. **The sidebar is 248 px (K1), and the main column's inline padding is 18 px (was 32 px).** At 1280 the document's
   content column must keep its 996 px width, and 248 px of sidebar would take 28 px of it; the padding gives back exactly
   that. The 600 to 1024 px band keeps its 180 px sidebar.
2. **The account footer's menu is its own non-modal menu, not `Menu.jsx`.** `Menu.jsx` is single-choice (radio items); the
   footer's items are actions (Account settings, Admin for an admin, Sign out). It has no scrim and closes on an outside
   press, on Tab out and on Escape, which returns focus to the name.
3. **The suite switcher opens inline in the sidebar's flow** (the spec's word), not as an overlay. So nothing overlays the
   navigation and the switcher needs no stacking order.
4. **The phone strip is two rows (Kyle's brief).** The account row the spec names is the avatar at the end of row two,
   which opens the same menu; the sign-out icon is hidden on a phone and Sign out is in that menu. The Archives group shows
   as one "Archives" item on a phone, because a row cannot hold every archive.
5. **Known deviation, decided pending Kyle (review round, 2026-10-12): the workspace slot shows the first workspace the
   user can see** (`GET /api/workspaces`, `body.workspaces[0]`). The code has no "current workspace" state outside suite
   mode, so "current" is not defined yet. In suite mode the slot is read-only, as the spec says. Kyle decides in the
   morning whether the slot should name the instance's one workspace, a chosen workspace, or something else.
6. **The page header is adopted on four pages only:** Account, Notifications, Notification preferences and Activity. The
   plan's "every page renders it" waits for the pages that PR 4 (home, the archive list, the archive view, the document) and
   PR 5 (Admin, Workspaces) rebuild anyway; GitHub is a deferred family. The header's toolbar slot is empty until PR 7.
7. **Removed, with their tests:** `NotificationBell` (the Notifications nav item replaces it), `SearchBox` (the palette
   replaces its only caller, and its non-inline mode had none), and `AccountPanel`, whose sign-out moved unchanged to
   `src/lib/sign-out.js` (its eight tests moved with it, same assertions). The top bar's snapshot test is gone; the suite-off
   render test is `Shell.test.jsx`, which asserts the product mark, no `.cc-suite` and no cluster.
8. **The palette lists archives by name from the client** (`GET /api/archives`, filtered as the user types), because the
   search API returns documents only. Documents come from `GET /api/search`, debounced 200 ms, and an empty query asks nothing.
9. **Dead CSS and tokens are removed:** `.topbar*`, `.mobile-nav`, `.log-footer`, `.account-button`, `.notification-bell*`,
   `.search-inline*`, `.search-dropdown*`, the non-inline `.search-box` family, the collapsed-sidebar hover rules and
   `#dropdown-backshadow`, with its pin in `leftover-burndown.test.js`. The bridge names `--topbar-height`,
   `--sidebar-collapsed` and `--footer-height` are retired (`bridge.test.js` updated); `--sidebar-width` is 248 px.
10. **`topbar.test.js` became `sidebar.test.js`** (the opacity pin, now on `--cx-surface-1`); `z-index.test.js`'s shell section is
    rewritten for a shell with no top bar (the sidebar at base; the account menu and the palette above it and the editor
    overlays), with its non-vacuity floor kept. `painted.test.js` and `tints.test.js` follow the new surfaces.
11. **Tests first, honestly stated:** `Shell.test.jsx` and `SearchPalette.test.jsx` were written before their components,
    but I did not capture their red run before implementing; they were run green after. The sign-out tests moved from
    `AccountPanel.test.jsx` with the same assertions.
12. **Not verified:** the two-cursor smoke (it needs two signed-in browsers). The editor's comment highlights were compared in
    one browser before and after and sit on the same text; remote cursors were not in the capture. See the research folder's
    README.

### Task 3.1 Rebase, and keep the dead-session path

- [x] After `fix/suite-switcher-and-dead-session` merges: rebase. `git grep -n "session-ended" --
      cloudcodex/src` lists the wiring the new layout must keep; its tests stay green, unedited.

### Task 3.2 The new layout's tests, red first

- [x] `tests/src/page_layouts/Std_Layout.test.jsx`: signed in, no `header.topbar`, no
      `footer.log-footer`, no `nav.mobile-nav`; one `aside.sidebar` whose children are, in order, the
      cluster (suite on) or product mark (suite off), `.workspace-slot`, `button.search-trigger`,
      `nav.sidebar__nav`, `.sidebar__footer`.
- [x] Suite on: no Workspaces link, and rendering `/workspaces` lands on `/`. Suite off: the link
      exists.
- [x] The Notifications link's accessible name is `Notifications, 3 unread` with a count of 3, and its
      pill reads `99+` at 150.
- [x] The footer menu: clicking the name opens a menu with Account settings and Sign out; Escape
      closes it and focus returns to the name; `#modal-dimmer` stays hidden.
- [x] `SearchPalette.test.jsx`: Ctrl K (and Meta K) opens it, Escape closes it, typing lists
      documents and archives from the existing search API (mocked through `util.jsx`).
- [x] `SuiteCluster.test.jsx`: the toggle contains an `svg.cc-suite__mark`, not an `img`.
- [x] **Expected:** all red.

### Task 3.3 Build it

- [x] `src/components/PageHeader.jsx`: `title`, `meta`, `primary` (one element), `toolbar` (the theme
      toggle slot, empty until PR 7), `tabs`. Every page renders it.
- [x] `Std_Layout.jsx`: the sidebar as the spec describes; delete `TopBar`, `MobileNav`, the footer,
      `CollapseIcon`, `ExpandIcon`, the collapse state and the `sidebarDefault` read; the bell dropdown
      is replaced by the nav item; the account dropdown by the footer `Menu` (PR 2's primitive).
- [x] `App.jsx`: in suite mode `/workspaces` and `/workspaces/:workspaceId` render
      `<Navigate to="/" replace />`.
- [x] `index.css`: delete the top bar, footer, mobile-nav and `#dropdown-backshadow` rules (and the
      pin in `leftover-burndown.test.js`); the sidebar at 248 px on `--cx-surface-1`, full height,
      sticky; nav items per the spec; at `max-width: 599px` the two-row strip.
- [x] `z-index.test.js`: the layering for a shell with no top bar, with its non-vacuity floor.

### Task 3.4 The document page keeps its width

- [x] Measure the document content column's width at 1280 before and after (a Playwright
      `boundingBox()` of `.editor-container`); **expected** equal widths, a changed `x` allowed.
      Record both numbers in the PR body. The two-cursor smoke.

### Task 3.5 Look

- [x] Every route at 1280 and 390, dark, suite on and off; the switcher open inline; the strip at
      390 and 320. `docs/maps/frontend-architecture.md` (the shell, sections 3b and 4).

---

**Review round (W6-CDX-40, 2026-10-12): the fixes, each tested first.** Every item is in `cloudcodex/`; the file and
line are the place to read.

- **Sign-in on the signed-out landing.** `NoLoginMessage` has a Sign in button (`src/page_layouts/Std_Layout.jsx:38`); it
  calls `signInFrom` (`src/hooks/useSignedOutTarget.js:155`): OIDC-only instances start `/api/auth/oidc/start`, anything
  else opens the Login modal. Tests: `tests/src/page_layouts/Std_Layout.signin.test.jsx`.
- **The palette joins the dialog stack.** `src/components/SearchPalette.jsx:103` registers it with `openDialog`; Escape and
  Tab are the stack's; Ctrl K is a no-op while `openOverlayCount()` is positive (`:84`) and is left to the browser in
  editable fields (`:78`); a result click moves focus to `.main-content`; the session notice dispatches
  `c2:close-overlays` first (`src/page_layouts/Std_Layout.jsx:147`). Tests: `tests/src/components/SearchPalette.test.jsx`,
  `tests/src/page_layouts/Std_Layout.palette-notice.test.jsx`.
- **The Workspaces gate, through the App's routes.** `tests/src/app-workspaces-gate.test.jsx` renders `App`: suite on
  redirects `/workspaces` and `/workspaces/:id`; suite off renders the page.
- **Sidebar Default removed.** The control (`src/components/AccountMenu.jsx`), its read in the preferences state, and the
  `data-sidebar-default` write (`src/userPrefs.js`) are gone; `tests/src/userPrefs.test.js` pins that nothing writes it.
- **The phone archive collapse.** `src/index.css` hides `.sidebar__group li:nth-child(n + 2)` (`:5508`); the rule is
  matched against the rendered sidebar with twelve or more archives in `tests/src/page_layouts/phone-strip.test.jsx`.
- **The phone account button has a name** (`src/components/AccountFooter.jsx:87`, `aria-label={name}`).
- **The unread pill no longer drifts.** The server broadcasts `read` and `read_all` only when the UPDATE changed a row
  (`services/notifications.js:192`, `:207`); the client takes the count from the server after a read instead of
  subtracting (`src/hooks/useNotificationChannel.js`). Tests: `tests/services/notifications.test.js`,
  `tests/src/hooks/useNotificationChannel.test.jsx`.
- **No flicker on navigation.** The unread count, the recent list and the archives are kept per user in
  `src/lib/inbox-cache.js` and shown at once on a remount; sign-out clears them. Tests:
  `tests/src/components/Sidebar.cache.test.jsx`, `tests/src/hooks/useNotificationChannel.test.jsx`.
- **The Notifications list is live.** It reloads on every inbox frame through `subscribeInboxFrames`
  (`src/pages/NotificationsPage.jsx:54`). Test: `tests/src/pages/NotificationsPage.live.test.jsx`.
- **Stale references removed:** the bottom-nav block and its comments, the unused `--cx-shadow-bar` and `--cx-shadow-nav`
  tokens, and the top-bar comments in `src/index.css` and `src/codex.css`.
- **Squads, invitations and workspace delete have a home in suite mode.** Admin's workspace row has Rename, New squad and
  Delete (`src/pages/AdminPage.jsx`, `WorkspacesPanel`); the expanded squad has Invite member, Rename squad, Delete squad
  and its pending invitations with Cancel invitation (`SquadsPanel`). They reuse the dialogs `WorkspacesPage.jsx` exports,
  and the server already lets an admin pass each route's check. Tests: `tests/src/pages/AdminPage.suiteWorkspace.test.jsx`.
- **The phone switcher overlays the navigation** (`src/index.css`, the 599 px block), so row one keeps its cells. The
  design pin is in `tests/design/z-index.test.js`.
- **Known deviation, decided pending Kyle:** the workspace slot shows the first workspace the user can see (deviation 5 above).

## PR 4: W6-CDX-41, lists, home and the document header

**Moved from PR 2 (W6-CDX-39, deviation 11), with the reason:** the document header's emoji (the edit, read, save, publish,
comment and history labels) and the export menu's emoji are replaced here, because this PR rebuilds the header. The editor
canvas's own toolbar glyphs stay with the deferred families.

### Task 4.1 Tests first

- [ ] `ArchivesPage` render test: no element with class `btn-danger` inside a list row; each row has a
      More actions `Menu` with Rename, Manage access and Delete.
- [ ] `EmptyState.test.jsx` and render tests that Home with no documents, an empty archive,
      Notifications with none and Activity with none each render `.empty-state`.
- [ ] The document header renders the author's `name`, never the email, and exactly one `.btn-primary`.
- [ ] **Expected:** red.

### Task 4.2 Build it

- [ ] Home (`HomePage.jsx`): `PageHeader`, the hero and the second search field gone, the grid on the
      card pattern. Archives, the archive view and tree, Workspaces (suite off), Activity, Notifications
      as the spec says. `src/components/EmptyState.jsx`.
- [ ] The document header: the mount in `Editor.jsx` is the only line that changes there;
      **expected** `git diff --stat cloudcodex/src/pages/Editor.jsx` shows the header lines only, and
      nothing under the editor canvas banners in `index.css` changes.
- [ ] Captures of every listed route, both widths, dark; the two-cursor smoke.

---

## PR 5: W6-CDX-42, settings, admin, not-found and first run

**Moved from PR 2 (W6-CDX-39, deviation 11), with the reason:** the admin console's emoji (the nav icons, the stats tiles and the
permission tick marks) are replaced here, because this PR rebuilds the console's sections as the tab row, and its tests are
rewritten in the same PR.

### Task 5.1 The server refusal, tests first (K6)

- [ ] `tests/routes/auth-update-account.test.js` (it exists; extend it), suite mode on (`SUITE_COMMAND_WORKSPACE_URL` and
      `SUITE_NAME` set), a user with a `user_identities` row: `POST /api/update-account` answers 403
      `{ success: false, code: 'managed_by_issuer' }` and changes nothing; the same for
      `POST /api/update-account/confirm-email`, `POST /api/2fa/enable`, `/2fa/totp/confirm`,
      `/2fa/disable` and `/2fa/disable/confirm`. Suite off, or no identity row: unchanged. **Expected:**
      red.
- [ ] A helper in `services/identity.js`, `isIssuerManaged(userId)` (one `SELECT 1 FROM
      user_identities WHERE user_id = ? LIMIT 1`), and a small middleware `refuseIssuerManaged` in
      `middleware/auth.js`, mounted on those six routes after `requireAuth`, active only when
      `readSuiteConfig().enabled`.
- [ ] `GET /api/2fa/status`'s existing `managed_by` field gains the value `'issuer'` for the same
      accounts, so the client has one signal.

### Task 5.2 The client, tests first

- [ ] `AccountMenu` tests: with `managed_by: 'issuer'`, the name, email, password and two-factor
      panels render read-only (no editable input, no submit), each with "Managed by " plus the provider
      name, and a link whose `href` is the configured account URL; with no URL, no link. Suite off:
      unchanged.
- [ ] `OIDC_ACCOUNT_URL`: `env-contract.js` (optional, per-instance, an https URL, http only outside
      production), `docs/getting-started.md` (the env-contract test reads it), `.env.example`, served
      to the client beside `OIDC_PROVIDER_NAME` where the provider name is already served.

### Task 5.3 Appearance (K8)

- [ ] `userPrefs.test.js` first: no `DENSITIES` export; a stored `{ density: 'compact',
      sidebarDefault: 'collapsed' }` loads without either key; `applyPrefsToDOM` never sets
      `--density-scale` or `data-sidebar-default`. **Expected:** red.
- [ ] Remove them from `userPrefs.js`, the panel, and the three `--density-scale` reads in
      `index.css`. The 95% line threshold holds.

### Task 5.4 Admin, not-found, first run

- [ ] Admin tests first: the sections render as a `.tabs` row; no emoji character in the admin
      markup (a test over the rendered text with `/\p{Extended_Pictographic}/u`); Revoke opens a
      confirm naming the invitation's address and calls `deleteAdminInvitation` only on confirm (X8);
      no Users row renders a bare numeric node without an accessible label (X7).
- [ ] Build: the tab row in a `PageHeader`; Overview as a quiet summary; member rows; not-found as the
      standalone card with the product mark; first run with a left-aligned list and links in
      `--cx-accent` (X5).
- [ ] Captures: Account (suite on, issuer-linked, and suite off), Admin's tabs, not-found, first run,
      both widths, dark.

---

## PR 6: W6-CDX-43, the light theme and the hue-based picker

### Task 6.1 The geometry fingerprint, first and green

- [ ] `tests/design/geometry-fingerprint.test.js`: for every rule in the editor canvas, comments and
      GitHub banners (`buckets.js`), collect each declaration whose property is not a colour property
      (`color`, `background`, `background-color`, `border-color`, `border*-color`, `outline-color`,
      `fill`, `stroke`, `box-shadow`, `text-decoration-color`, `caret-color`, `accent-color`), and
      compare a SHA-256 of the sorted list with `tests/design/geometry-fingerprint.json`, written at the
      start of this PR. Failure message: "A deferred surface changed geometry. This track may change
      colour only there (K3); a layout change belongs to UI-later."
- [ ] **Expected:** green before any other change, and red when one `padding` in the comments banner
      changes (confirmed to have landed, then reverted).

### Task 6.2 The light block

- [ ] Add the `light` column to `suite-theme.json`; `suite-theme.test.js` checks both. **Expected:**
      red.
- [ ] `codex.css`: `[data-theme='light']` with every binding the dark block has, `color-scheme:
      light`, the light status text (`oklch(0.5 0.13 150)`, `oklch(0.5 0.11 78)`), the collapsed
      washes with deep labels.
- [ ] Every gate in both themes: `contrast.test.js` resolves each pair under each theme block (the
      vendored parser reads one selector at a time; run it per theme); `tints`, `painted`,
      `code-blocks` (a light syntax palette in `codex.css`), `presence-palette`.

### Task 6.3 The picker writes a hue

- [ ] `accents.test.js` first: the four contract steps per theme, as strings, for every hue:

```javascript
const STEPS = {
  dark:  { text: 'oklch(0.68 0.13 H)', hover: 'oklch(0.78 0.1 H)', fill: 'oklch(0.68 0.13 H)', wash: 'oklch(0.21 0.055 H)' },
  light: { text: 'oklch(0.47 0.12 H)', hover: 'oklch(0.41 0.1 H)', fill: 'oklch(0.68 0.13 H)', wash: 'oklch(0.97 0.025 H)' },
};
```

      The `[data-theme='<t>'][data-accent]` blocks in `codex.css` declare `--cx-accent`,
      `--cx-accent-hover`, `--cx-accent-fill` and `--cx-select-wash` as these expressions with
      `var(--cx-accent-h)` for H; with each hue substituted, every text step measures 4.5:1 or more on
      every surface of its theme, the fill carries `--cx-on-accent` at 4.5:1 or more, and the focus
      ring 3:1 or more. 8 hues by 4 surfaces by 2 themes, with a count assertion. **Expected:** red.
- [ ] `applyPrefsToDOM`: set `--cx-accent-h` to the hue and `data-accent` on `<html>`, or remove both;
      never set `--cx-accent*` inline. `accents.js` exports the `STEPS` table so the test and any
      future reader share it.

### Task 6.4 The deferred families, colour only

- [ ] For each literal colour in the editor, comments and GitHub banners (the ledger's 399 at
      `f0bc965`, re-measured): a `--cx-` binding in `codex.css` whose dark value is the literal and
      whose light value is chosen and measured, and the rule reads it. The ledger shrinks by exactly the
      tokenised count; the fingerprint stays green. If the diff grows past review size, this task is a
      second PR of the same session.

### Task 6.5 Look

- [ ] Every route at both widths in dark and light (set `data-theme` by hand or in the capture script,
      since the switch lands next), Appearance with all eight accents in both themes, a document with
      two cursors and a comment in light.

---

## PR 7: W6-CDX-44, the theme switch and the suite preference contract

### Task 7.1 The domain, server side

- [ ] `tests/services/suite.test.js` first: with suite mode on, `SUITE_PREFERENCE_DOMAIN` of
      `Example.com`, `com`, `.example.com`, `example.com.`, `example.com:443`, `https://example.com`,
      `10.0.0.1`, `[::1]`, `localhost` and `suite.localhost` each throw a message naming the variable;
      `example.com` with `APP_URL=https://codex.other.org` throws; `example.com` with
      `APP_URL=https://codex.example.com` returns it; unset returns `null`; suite mode off ignores it.
- [ ] `services/suite.js`, inside `readSuiteConfig`:

```javascript
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function readPreferenceDomain() {
  const raw = process.env.SUITE_PREFERENCE_DOMAIN?.trim();
  if (!raw) return null;
  const labels = raw.split('.');
  const top = labels[labels.length - 1];
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(top) || top === 'localhost') {
    throw new Error('SUITE_PREFERENCE_DOMAIN must be a lowercase domain of two or more labels, '
      + 'with no scheme, port or dots at either end, and not an IP address or localhost.');
  }
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    const host = new URL(appUrl).hostname;
    if (host !== raw && !host.endsWith(`.${raw}`)) {
      throw new Error(`SUITE_PREFERENCE_DOMAIN (${raw}) must be APP_URL's host or a parent of it.`);
    }
  }
  return raw;
}
```

      and the enabled branch returns `preferenceDomain: readPreferenceDomain()` (the off branch
      `preferenceDomain: null`). `routes/suite.js`'s `GET /api/suite` adds `preferenceDomain`. A route
      test pins both shapes.
- [ ] `env-contract.js`: `{ name: 'SUITE_PREFERENCE_DOMAIN', kind: 'optional', perInstance: true, ... }`
      beside the other `SUITE_*` entries; a row in `docs/getting-started.md`; `.env.example`.

### Task 7.2 The module, tests first

- [ ] `tests/src/lib/suite-prefs.test.js` (jsdom), one case per contract rule: each precedence step
      beats the next; an invalid value at each step falls through; nothing at all gives `dark`;
      `setTheme('light')` with `preferenceDomain: 'example.com'` on `codex.example.com` writes
      `cc_suite_theme=light; Path=/; Max-Age=34560000; SameSite=Lax; Domain=example.com` (plus `Secure`
      on https), then `cc_suite_theme=; Path=/; Max-Age=0`, then localStorage; on `localhost`, or with
      a non-matching host, no `Domain`; a `setTheme` issued before `/api/suite` resolves writes nothing
      until it does; `clearTheme()` expires both forms and removes the key; the same for the accent;
      `visibilitychange` and `storage` re-apply. Spy on the `document.cookie` setter to see each write.
- [ ] `src/lib/suite-prefs.js` exports `resolveTheme()`, `resolveAccent()`, `setTheme(value)`,
      `clearTheme()`, `setAccent(hue)`, `clearAccent()`, `migrateLegacy()`, `watch()`. It reads the
      cookie by exact name with only ASCII space and tab stripped (the session cookie's rule), and
      validates against the two allowlists, which it shares with the pre-paint script's test.

### Task 7.3 The pre-paint script and its hash

- [ ] `index.html`: `<meta name="color-scheme" content="dark light">` in the head, then this script,
      before any stylesheet link:

```html
<script>
  (function () {
    var THEMES = { light: 1, dark: 1 };
    var HUES = { '232': 1, '200': 1, '325': 1, '131': 1, '355': 1, '50': 1, '175': 1, '275': 1 };
    var LEGACY = { blue: '232', cyan: '200', pink: '325', lime: '131', nova: '355', solar: '50',
      aurora: '175', nebula: '275', rose: '355', amber: '50', emerald: '175', violet: '275',
      coral: '355', apricot: '50', jade: '175', iris: '275' };
    function own(map, key) { return Object.prototype.hasOwnProperty.call(map, key); }
    function cookie(name, ok) {
      var parts = document.cookie ? document.cookie.split(';') : [];
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].replace(/^[ \t]+/, '');
        var eq = part.indexOf('=');
        if (eq > 0 && part.slice(0, eq) === name && own(ok, part.slice(eq + 1))) return part.slice(eq + 1);
      }
      return null;
    }
    function stored(name, ok) {
      try { var v = localStorage.getItem(name); return v !== null && own(ok, v) ? v : null; } catch (e) { return null; }
    }
    function legacyHue() {
      try {
        var key = JSON.parse(localStorage.getItem('c2-user-prefs') || '{}').accentColor;
        return typeof key === 'string' && own(LEGACY, key) ? LEGACY[key] : null;
      } catch (e) { return null; }
    }
    var root = document.documentElement;
    var theme = cookie('cc_suite_theme', THEMES) || stored('cc_suite_theme', THEMES);
    if (!theme) {
      try { theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch (e) { theme = 'dark'; }
    }
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', theme);
    var hue = cookie('cc_suite_accent', HUES) || stored('cc_suite_accent', HUES) || legacyHue();
    if (hue) { root.style.setProperty('--cx-accent-h', hue); root.setAttribute('data-accent', ''); }
  })();
</script>
```

- [ ] `tests/src/theme-boot.test.js`: read the script's text from `index.html`, run it with
      `new Function` in jsdom under each precedence case, and assert `data-theme`, the meta content,
      `--cx-accent-h` and `data-accent`; assert `LEGACY` equals `ACCENTS` composed with
      `LEGACY_ACCENT` from `accents.js`, and `HUES` equals the hues of `ACCENTS`.
- [ ] `cloudcodex/theme-boot-hash.js` exports `THEME_BOOT_HASH = "'sha256-<base64>'"`; `app.js`'s
      `scriptSrc` becomes `["'self'", THEME_BOOT_HASH]`. `tests/theme-boot-hash.test.js`: the SHA-256
      (base64) of the exact text between `<script>` and `</script>` of the inline script in
      `index.html` equals the constant; after a build (`npm run build` in CI runs before it, or the test
      builds into a temp dir), `dist/index.html` carries the identical bytes; an `app.test.js` case in
      production mode finds the constant in the served `Content-Security-Policy`. Failure message names
      both places to update.
- [ ] `codex-css.test.js`'s "pins the dark theme on the root element" becomes "carries
      `data-theme="dark"` as the no-script default".

### Task 7.4 The toggle, Appearance and the migration

- [ ] A `ThemeToggle` in `PageHeader`'s toolbar slot: an icon button named "Switch to light theme"
      or "Switch to dark theme", calling `setTheme`. Appearance gains Theme (Match system, Light, Dark;
      Match system calls `clearTheme`); the accent swatches call `setAccent(hue)`, with a Default
      swatch calling `clearAccent`. `main.jsx` calls `migrateLegacy()` and `watch()` once at start.
- [ ] Tests: the toggle's name flips with the theme; Appearance reflects the resolved values;
      `migrateLegacy` turns `c2-user-prefs.accentColor = 'rose'` into `cc_suite_accent = 355` and
      removes `accentColor`.

### Task 7.5 A real run

- [ ] On the local three-host stack (sibling hosts under one parent domain, with
      `SUITE_PREFERENCE_DOMAIN` set to it): a theme chosen in Codex is the theme the sibling product
      opens in, where the sibling's W6-CMD-43 has landed; if it has not, record the cookie as the
      browser stores it (name, value, domain, path, expiry) and say the round trip is unverified. On
      plain `localhost`: the choice persists per product through localStorage. A throttled load (CPU
      6x slowdown) shows no frame in the wrong theme, captured. Record in
      `docs/research/suite-theme-switch-<date>/`.
- [ ] Captures of every route in both themes at both widths.

### Task 7.6 Retire the track

- [ ] `docs/maps/frontend-architecture.md` (the shell, page headers, the themes, `suite-prefs.js`, the
      pre-paint script and its hash) and `docs/maps/build-test-and-ops.md` (the gates in both themes,
      the fixture, the fingerprint).
- [ ] Delete `docs/specs/2026-10-11-suite-ui-alignment.md` and this plan; remove their rows from
      `docs/specs/README.md` and `docs/README.md`; mark the UI alignment row in `docs/specs/roadmap.md`
      shipped with its PR numbers.
- [ ] Lint, test, coverage, build, CI green.
