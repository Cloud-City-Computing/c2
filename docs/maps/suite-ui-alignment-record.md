# Suite UI alignment: the record

**Status: retired (W6-CDX-44, 2026-10-12).** The track's spec and plan (`docs/specs/2026-10-11-suite-ui-alignment.md`
and `docs/plans/2026-10-11-suite-ui-alignment.md`) are deleted. This page keeps what is still live from them, so
nothing is lost: the suite preference contract that Codex and Cloud Command both implement, the gamut open item, the
deviation lists from each session, and every decision that is marked pending Kyle. The text below is copied from the
deleted files, unchanged except for the one heading that now says version 2. The mechanism is in
[`frontend-architecture.md`](frontend-architecture.md) (section 5, the preferences) and
[`build-test-and-ops.md`](build-test-and-ops.md) (the gates, the fixture, the pre-paint hash).

## 1. The contract, and the sections that follow it

Shared by Codex and Cloud Command. A change to it lands in both repositories in the same motion. Codex implements it in
`src/lib/suite-prefs.js` (one module), the pre-paint script in `index.html`, and `services/suite.js`
(`SUITE_PREFERENCE_DOMAIN`). Command's copy is its own.

### The suite preference contract (version 2)

Both products implement this section identically. The sibling product's session that implements it
is W6-CMD-43; a change to this section is a change to both repositories in the same motion, never
to one.

### Why a parent-domain cookie

The products are sibling hosts under one registrable domain on the test box
(`command.cloudcitycomputing.com`, `codex.cloudcitycomputing.com` and later
`<instance>.codex.cloudcitycomputing.com`, and `id.cloudcitycomputing.com`, D-J). A preference that
both read must be readable **before first paint** and **on a signed-out page**, with no request. A
non-HttpOnly cookie on the parent domain is the one store that meets all three. localStorage is
per-origin, so it cannot cross hosts; it remains the fallback where cookies cannot be shared (local
development on `localhost`, or an install outside a suite). An ID-token claim was the runner-up and
lost: it needs a sign-in and a server read, so it cannot set the theme of the sign-in page or avoid a
flash. A `__Host-` cookie is impossible here (that prefix forbids `Domain`), and the session cookies
stay host-only exactly as before; nothing in this contract touches them.

### Names and values

| Store | Theme | Accent |
|---|---|---|
| Cookie name | `cc_suite_theme` | `cc_suite_accent` |
| localStorage key | `cc_suite_theme` | `cc_suite_accent` |
| Valid values | exactly `light` or `dark` | exactly one of `232`, `200`, `325`, `131`, `355`, `50`, `175`, `275` |

The accent values are the eight picker hues in degrees, written in ASCII decimal with no sign, no
leading zero and no unit. They are blue 232, cyan 200, pink 325 (labelled Fuchsia), lime 131,
nova 355, solar 50, aurora 175 and nebula 275 (`src/tokens/accents.js:16-19`; the names were
confirmed by Kyle on 2026-10-11). **Any other value, including an empty one, means "not set".** Names
and labels are each product's own; only the hue crosses the boundary.

### The suite preference domain

- Each product reads one optional variable, **`SUITE_PREFERENCE_DOMAIN`**, honoured only in suite
  mode. On the test box its value is `cloudcitycomputing.com`.
- Validated at boot: lowercase letters, digits and hyphens in dot-separated labels; at least two
  labels; no scheme, port, path, leading or trailing dot; not an IP literal; not `localhost` and not
  ending in `.localhost`. Where the product knows its own public URL (here, `APP_URL`), that URL's host
  must equal the domain or end with `.` plus the domain. A violation fails the boot with a message
  naming the variable.
- The browser learns it from the product (here: `GET /api/suite` gains `preferenceDomain`, a string,
  or `null` when suite mode is off or the variable is unset; the route is already public, and the
  value is the site's own domain).
- **The client uses it only when `location.hostname` equals it or ends with `.` plus it.** Otherwise
  every write is host-only. The browser refuses a `Domain` that is a public suffix on its own, so a
  misconfiguration degrades to per-product preferences, never to a leak.

### Writing

A write sets, in this order:

1. The cookie: `<name>=<value>; Path=/; Max-Age=34560000; SameSite=Lax`, plus `; Secure` when
   `location.protocol` is `https:`, plus `; Domain=<suite preference domain>` when the domain is in
   use (the rule above). Never `HttpOnly`: the pre-paint script must read it. 34560000 seconds is 400
   days, the longest lifetime browsers keep.
2. When the domain is in use, a host-only expiry of the same name
   (`<name>=; Path=/; Max-Age=0`), so an older host-only copy can never shadow the shared one.
3. The localStorage key, to the same value.
4. The document, at once (see Applying).

**A product never writes before it knows whether a domain is in use.** A host-only write made while a
shared cookie exists would leave two cookies of one name, and browsers list the older first, so the
user's newer choice would lose on the next read. Each product routes every write through one function
that awaits its suite configuration (one cached request) before touching a cookie.

**Clearing** ("Match system" for the theme, "Default" for the accent) expires the cookie with
`Max-Age=0` in its shared form when the domain is in use, always expires the host-only form too, and
removes the localStorage key.

### Reading, and precedence

For each preference, the first step that yields a valid value wins:

| Step | Theme | Accent |
|---|---|---|
| 1 | the first `cc_suite_theme` entry in `document.cookie` with a valid value | the first valid `cc_suite_accent` entry |
| 2 | localStorage `cc_suite_theme` | localStorage `cc_suite_accent` |
| 3 | the product's own legacy stored theme, if it has one (Codex has none) | the product's own legacy accent (Codex: `c2-user-prefs`'s `accentColor`, mapped through `successorOf` to a hue) |
| 4 | `light` when `matchMedia('(prefers-color-scheme: light)')` matches, otherwise `dark` | not set: the package's fixed accent ramp |

- A step that throws (storage blocked, no `matchMedia`) is skipped. With nothing at all, the theme is
  `dark`, which is also the attribute `index.html` carries for a page with script disabled.
- Step 3 is read by the pre-paint script, but the **migration** (writing the value through the write
  rule and deleting the legacy value) runs once the application has loaded, never in the pre-paint
  script.
- When step 1 wins and localStorage holds a different value, the product updates localStorage to
  match, so a later cookie loss falls back to the newest choice.

### Applying

- **Theme:** `document.documentElement.dataset.theme` is set to the value, and the content of a
  `<meta name="color-scheme">`, where the page has one, is set to the same value. Each theme block
  declares `color-scheme`, so native controls and scrollbars follow.
- **Accent:** with hue H, each product derives four steps per theme, and the focus ring follows the
  text step:

  | Step | Dark | Light |
  |---|---|---|
  | Text, links, icons | `oklch(0.68 0.13 H)` | `oklch(0.47 0.12 H)` |
  | Hover | `oklch(0.78 0.1 H)` | `oklch(0.41 0.1 H)` |
  | Fill (a background; its label is the product's on-accent ink) | `oklch(0.68 0.13 H)` | `oklch(0.68 0.13 H)` |
  | Fill hover (a background on hover; v2, below) | `oklch(0.78 0.1 H)` | `oklch(0.78 0.1 H)` |
  | Selection wash | `oklch(0.21 0.055 H)` | `oklch(0.97 0.025 H)` |

  **v2, 2026-10-12: adds fillHover; Command adopts it in a follow-up PR.**
  The primary button's hover on a filled accent cannot be the light theme's text hover (the deep step, which the dark
  ink measures 2.2:1 on as a fill), so the fill has its own hover, lighter than the fill in both themes. Until Command
  adopts it, its primary hover is not the contract's.

  The default bindings are the package ramp's own shapes: dark uses `--accent-400` and `-300`, and light uses
  `--accent-600` for the text step (`oklch(0.49 0.12 240)`), `--accent-700` for the hover and `--accent-400` for the
  fill. A picked hue swaps the hue into the contract's values above, so the picked light text step (`0.47`) is the
  formula, not the default light text colour. The default and a picked hue differ only in hue. Computed: the light text step measures at least 4.81:1 on every proposed light
  surface for all eight hues, and the fill carries the dark ink at about 6.9:1. **Each product's
  gates must prove, for all eight hues and both themes:** the text step at 4.5:1 or more on every
  surface it paints, the fill's label at 4.5:1 or more on the fill and on the fill hover, and the focus ring at 3:1 or more. If either
  product's gate finds a failing pair, the step changes in this table and in both products together,
  as contract version 2.
- With no accent set, each product keeps its own default bindings onto the package ramp.

### Keeping open pages in step

Each product re-resolves both preferences, and applies any change, on `visibilitychange` to
`visible` and on a `storage` event for either key. A choice made in one product shows in the other's
open tab the next time that tab is looked at, with no reload.

### What this contract never does

Neither cookie is read by a server, logged, or written into HTML. Both are parsed by exact match
against the allowlists above, never evaluated, and never used as markup. Any host under the domain
can set them; the worst a hostile sibling host can do is change a colour. They add about 40 bytes to
requests on the domain's hosts.

---

## 2. The track's recorded items

### 2.1 W6-CDX-38, recorded at execution

**Recorded at execution (W6-CDX-38).** Three choices the spec did not spell out, each in the plan's deviation list: the danger fill moved with its label and hover (a white label on the bright fill fails 4.5:1), so the danger button's inset-ring hover landed here; a hover on a row inside a panel is the sunken well, since a border-colour hover gives a borderless row nothing; and X4 inherits the typeface only (`font-family`), because the `font` shorthand moved the top-bar search field from 31px to 36px.

### 2.2 W6-CDX-43, the gamut open item and the deviations from the contract

The gamut item is still open: contract version 2 changed no step, and any change to a step is a version 3 that lands
in both products. The deviations below are each decided pending Kyle.

**Open item: gamut (contract version 1, not changed here).** The contract steps are not all inside sRGB. Measured
by converting each `oklch(L C H)` to linear sRGB and flagging any channel outside 0 to 1 before clipping (the
browser clips; the vendored gate clips too, and every pair still passes on the clipped colour). Of the four
contract steps (text, hover, fill, wash) per theme, 19 of 64 hue-theme-step combinations fall outside sRGB. Per hue:
232 has 4 (dark wash; light text, hover, wash), 200 has 6 and 175 has 6 (dark text, fill, wash; light text, hover,
fill), 355, 275 and 50 have one each (the light wash). Counting the dark avatar step as well gives 29 of 80. The sibling product's count of 17 for the same three hues is not reconciled
here, since its script is not in this repository. Any change to a step is contract version 2 and lands in both
products together; no step was changed in this PR.

**Deviations from the contract, each decided pending Kyle:**
1. `--cx-accent-fill-hover` is a sixth binding. The primary button's hover on a filled accent cannot be the light
   theme's text hover (`--cx-accent-hover`, the deep step): the dark ink measures 2.2:1 on it. The fill hover is
   `oklch(0.78 0.1 H)` in both themes (the dark hover step), and the light fill is `--accent-400` as before.
2. `--cx-accent-dark` (the white avatar label's dark step) is derived per hue in the picked-accent blocks, as the
   prior picker wrote it, so the avatar follows the pick. It is `oklch(0.45 0.13 H)` in both themes.
3. The light `--cx-on-accent` is the table's `oklch(0.16 0.03 240)` (restored in review; the first draft used the dark ink).
   The presence label constant `INK_LUMINANCE` is pinned to it. The dark ink (`0.14`) is 0.0014 away, so
   `presence-label.test.js` measures each cursor colour's real label in each theme.
4. The suite-theme fixture's light column is the table's, on-accent included.
5. Dark values changed only where the original dark value fails its gate (W6-CDX-43 review, item 5). The list, with the
   original and the new value and the measured contrast, is in the plan's PR 6 deviation list; `deferred-dark.test.js`
   pins every other colour declaration of the deferred families to its original dark value.
6. The picked accent's steps are derived in CSS (K7). `data-accent` carries the key; `--cx-accent-h` carries the hue.
7. The light hover washes of the deferred families are raised to a floor, so each hover steps at least 0.025 (oklab L)
   from the surface beneath it (`deferred-hover.test.js`). The light black washes under 0.4 (the inline code, the code
   header) become a 0.06 to 0.15 ink wash, so a code span is not a grey slab on the light page. Dark is unchanged.

## 3. Deviation lists, by session

Each list is the plan's "recorded at execution" text for its session, verbatim.


### PR 1 (W6-CDX-38)

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

### PR 2 (W6-CDX-39)

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

### PR 3 (W6-CDX-40)

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

### PR 3 review round and the PR 4 move (W6-CDX-40, W6-CDX-41)

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

### PR 4 (W6-CDX-41)

**Deviations, recorded at execution (W6-CDX-41, 2026-10-12).** The plan is the approval; each is a place where the code,
the captures or a shared rule proved a step wrong, or a step needed a choice the plan did not spell out. Captures and
measurements are in `docs/research/w6-cdx-41-lists-2026-10-12/`.

1. **The count on each archive row needed a server field.** `GET /api/archives` gained `log_count`, a correlated count over
   `logs` for the same archive ids the list already filters by access (the log tree lists every document of an archive to
   anyone with archive read access, so the count reveals nothing new). Tested in `tests/routes/archives.test.js`.
2. **"New Log the page's one primary" reads as the page header's primary.** On the archive list the header's primary is New
   Archive, because New Log belongs to one archive. The expanded tree keeps its own New Log (a primary inside the expanded
   section, not the header). **Decided pending Kyle.**
3. **Home keeps its one in-page search** (the explore field, which carries the filters and the sort). The shell's "Search or
   jump to" trigger is on every route, so it is not counted as a second field on Home. **Decided pending Kyle.**
4. **The Home header's meta is a fixed line,** not the count: the browse status line already shows the filtered count.
5. **The Archives "← Squad" control is the first More actions item, "Go to squad".** Its function is unchanged.
6. **One Edit control in read mode.** The document header's Edit is the page primary, and the editor toolbar's own read-mode
   Edit is removed (momus round one, item 3; a page test pins exactly one control named Edit). The toolbar's other controls
   are unchanged.
7. **The toolbar's emoji became stroke icons at 13 px** (the plan's moved list: edit, read, save, publish, comment, history,
   the comment manager and export). Buttons keep their height (26 px at the small size). The Export button is 9 px wider,
   and the read toolbar 4 px shorter, because the emoji no longer set a 30 px line box. The canvas keeps its size.
8. **The edit-mode column stays 708 px, as before.** A shorter header had let the edit page fit the 860 px viewport, which
   widened the column to 716 px and broke the plan's width rule. The header keeps the vertical rhythm the page had (read
   toolbar at 177 px, edit at 183 px, as before), and edit mode carries 6 px more header below it, so the page overflows as
   it did and `.tiptap` measures 706 px. Trimming the header instead, as the review suggested, removes that overflow and
   widens the column, so it was not done. Measured in `docs/research/w6-cdx-41-lists-2026-10-12/README.md`.
9. **The archive's page header is shown only with no document open.** With a document open, the document header's crumb
   names the archive, so the two headers do not repeat it. The tree is headed "Documents" (the archive's name is the page
   header's title and the crumb's text).
10. **The phone shell's rows are `auto minmax(0, 1fr)`** (in the phone block only). The shell's rows used to stretch evenly
    when a page was shorter than the 100 vh shell: the strip grew to 283 px on GitHub and centred its connect card in the
    gap. Now the strip keeps its height and the work area fills the rest; `align-content: start` was tried first and
    collapsed nothing, but moved GitHub's card to the top, so it was not kept. Desktop and the no-sidebar shell are untouched.
11. **`.archive-view--headed` takes the header's height off the grid's minimum,** so the placeholder does not scroll at 1280.
12. **The Activity page is full width** (`max-width: 760px` removed), and its meta line is 12 px faint text. Its rows already
    had primary names and accent links. Workspaces (suite off) is not touched: it is W6-CDX-42's page.
13. **The More actions menu is `Menu` in `mode="actions"`,** not a second primitive. Its popup end-aligns under the trigger, so
    a phone never pushes it off the screen. Its danger item is text, with the sunken hover.
14. **Test files differ from the plan's names.** The archive-list render tests are `tests/src/components/ArchiveRows.test.jsx`
    (the list is `ArchiveBrowser`, which `ArchivesPage` renders); the empty-state and page tests are
    `tests/src/pages/lists-and-home.test.jsx`; the document header is `tests/src/components/DocumentHeader.test.jsx`.
    The More actions menu's tests are `tests/src/components/Menu.actions.test.jsx`.
15. **Not run:** the two-cursor smoke (it needs two signed-in browsers). The captures measure the editor's boxes, not its
    comment highlights or remote cursors.

### PR 5 move (W6-CDX-42)

## PR 5: W6-CDX-42, settings, admin, not-found and first run

**Moved from PR 2 (W6-CDX-39, deviation 11), with the reason:** the admin console's emoji (the nav icons, the stats tiles and the
permission tick marks) are replaced here, because this PR rebuilds the console's sections as the tab row, and its tests are
rewritten in the same PR.

### PR 5 (W6-CDX-42)

**Deviations, recorded at execution (W6-CDX-42, 2026-10-12).** The plan is the approval; each is a place where the
code or Kyle's binding decisions required a choice the plan did not spell out.

1. **The update-account refusal is checked in its handler, not by `refuseIssuerManaged`.** That route reads its session
   from the body, so there is no `requireAuth` to mount after. The other five routes mount the middleware as planned.
2. **`managed_by: 'issuer'` is reported only in suite mode**, the same condition as the refusal. Suite off, the field keeps
   its W6-CDX-5 meaning, so an OIDC session still reads `'oidc'`.
3. **There is one `--density-scale` read, not three.** It was the `.settings-panel` padding; it is now `28px`, which is the
   value the scale produced at its default.
4. **Admin lists.** Users and Invitations are member rows. The squad cards keep their member and invitation tables (the
   permission matrix is tabular) inside `.admin-table-wrap`. Workspaces keeps its table.
5. **PageHeader on GitHub settings: decided pending Kyle.** Codex has no GitHub settings page. The connection lives in
   Account's Linked Accounts, which already sits under the Account PageHeader. `/github` is the repository browser, which is
   the deferred GitHub family, so it is not touched here.
6. **Password is managed by the issuer in the read-only panel, but the password-reset route is not refused.** The plan's
   route list names the update and 2FA writes only. A reset through the email link still sets a local password for an
   issuer-linked account. Decided pending Kyle: whether `/api/reset-password` joins the refusal.
7. **"Managed by" names the served sign-in label** (`providers.oidc.name`), which falls back to the suite name when
   `OIDC_PROVIDER_NAME` is unset. The plan says `OIDC_PROVIDER_NAME` exactly. Decided pending Kyle.
8. **Accent colour and preferred editor stay.** K8 says Codex keeps "only the editor font size"; the spec and this plan keep
   the accent and the preferred editor too. Decided pending Kyle; the removal is limited to density and the sidebar default.
9. **Labels in sentence case:** "Invite user" and "New workspace" replace "+ Invite User" and "+ New Workspace".
10. **Tests first, unevenly.** The userPrefs, OIDC config, env contract, issuer refusal, AccountMenu, first-run and destructive
    copy tests were written red first. The Admin tab tests were written after the page and then run against the previous
    `AdminPage.jsx`, where all eleven failed. The not-found and Workspaces header tests were written alongside their code.
11. **The local password routes and the admin 2FA reset refuse an issuer-linked account (review round, security).** The plan
    named the account writes only. Login with a password is refused as well (decided pending Kyle, security-first: the login
    would otherwise skip the issuer's second factor on an account whose local hash is still set). Forgot-password answers
    generically and sends no mail; reset-password refuses without writing; the admin 2FA reset refuses. Covered by
    `tests/integration/suite-issuer-local-sign-in.test.js`, mutation-checked one route at a time.

### PR 6 (W6-CDX-43)

**Deviations, recorded at execution (W6-CDX-43, 2026-10-12).** Full list and reasons in the spec's "Recorded at
execution" section. In short: the picker's steps are CSS-derived from `--cx-accent-h` (K7); a sixth binding,
`--cx-accent-fill-hover`, carries the primary button's hover (the light text hover cannot be a fill); the light
on-accent is the dark ink (presence label); dark values changed where the new per-theme gate found a dark failure
that predates the track; the geometry fingerprint was written before the colour pass and is green after it; and the
tests for `userPrefs` and the accent swatch were rewritten after the code, not before (the picker's behaviour changed
in the same commit). The daylight theme is named `daylight` in the gates, because the vendored parser reserves
`light` for its base map.

**Review round, W6-CDX-43 (2026-10-12): dark changes, with before and after.** The review asked that dark be byte-identical
in the deferred families unless a contrast gate fails. `tests/design/deferred-dark.json` holds the resolved dark value of
every colour declaration in those families from the original tree; `deferred-dark.test.js` fails on any other change. The
sites below are the only dark changes. "Before" is the original dark value and its lowest measured contrast over the
surfaces the rule paints on (the original tree fails each one); "after" is the new value and its lowest contrast.

| Site | Dark before (contrast) | Dark after (contrast) |
|---|---|---|
| `.gh-file-picker__item.selected` | `#fff` on the accent (2.80) | the on-accent ink (7.10); the fill is unchanged in dark |
| `.gh-btn-danger-ghost:hover` | `#f44336` (4.40) | the bright danger, `oklch(0.87 0.1 25)` (10.02) |
| `.gh-history__file-status--removed`, `.gh-pr-badge--closed` | `#f85149` (4.47) | the bright danger (9.27) |
| `.gh-history__file-status--renamed` | `#8282dc` (4.24) | the violet, `oklch(0.86 0.1 291)` (9.07) |
| `.gh-pr-badge--merged` | `#a371f7` (4.33) | the violet (9.14) |
| `.gh-diff__hunk-header` | `rgba(44, 167, 219, 0.7)` (3.61) | the picked accent text step, `oklch(0.68 0.13 230)` (5.75) |
| `.editor-status.success` | the success text (4.43) | the bright success, `oklch(0.86 0.15 151)` (9.65) |
| `.editor-status.error` | the danger text (4.01) | the bright danger (9.51) |
| `.comment-sidebar__count`, `.comment-btn--primary`, `.comment-btn--active`, `.comment-count-badge` | `#fff` on the accent fill (2.80) | the on-accent ink (7.10) |
| `.comment-tag`, `.comment-tag-btn--active` on the comment, suggestion and issue kinds | `#fff` on the kind fill (2.36 to 3.49) | the ink (5.70 to 8.41). The note and question kinds keep their original labels (`#fff` on `#ab47bc`, 4.82; `#222` on `#ffa726`) |
| `.document-readonly blockquote` | `--text-muted` (4.33) | `--text-secondary` (6.61) |
| `.code-lang-badge` | `#888` (4.38) | `--text-secondary` (6.27) |
| `.document-readonly code` | `#e06c75` (4.45) | the bright danger (8.79) |
| `.collab-avatar`, `.remote-cursor__label` | `#fff`, which measures under 4.5:1 on nine of the ten cursor colours | the label `avatarLabel()` chooses for each cursor colour, inline; `presence-label.test.js` resolves it in each theme |

Every other site is dark-identical, including the restored `.gh-file-actions .btn.active`, `.gh-history__detail-actions
.btn.active`, `.tiptap-toolbar__btn--active`, `.gh-history__file-status--added`, `.gh-pr-badge--open`, `.comment-btn--resolve`,
`.comment-btn--delete`, `.comment-btn--icon:hover`, the GitHub status icons, the note and question kinds, and the code wash.
Captures: the original tree's dark state of the GitHub history, the read-only document and the editor is in
`docs/research/w6-cdx-43-light-theme-2026-10-12/dark-before/`; the same pages after the change are in `shots/`.

## 4. Decisions marked pending Kyle

Every item below is a choice the track made without Kyle's sign-off, with the reasoning in the list above. Kyle may
confirm or reverse each one. The first group is from the track's sessions (verbatim lines from the lists above); the
second is from W6-CDX-44, the session that retired the track.

### From the track's sessions

- spec gamut: **Deviations from the contract, each decided pending Kyle:**
- PR 3 (W6-CDX-40): 5. **Known deviation, decided pending Kyle (review round, 2026-10-12): the workspace slot shows the first workspace the
- PR 3 review round and the PR 4 move (W6-CDX-40, W6-CDX-41): - **Known deviation, decided pending Kyle:** the workspace slot shows the first workspace the user can see (deviation 5 above).
- PR 4 (W6-CDX-41): section, not the header). **Decided pending Kyle.**
- PR 4 (W6-CDX-41): jump to" trigger is on every route, so it is not counted as a second field on Home. **Decided pending Kyle.**
- PR 5 (W6-CDX-42): 5. **PageHeader on GitHub settings: decided pending Kyle.** Codex has no GitHub settings page. The connection lives in
- PR 5 (W6-CDX-42): issuer-linked account. Decided pending Kyle: whether `/api/reset-password` joins the refusal.
- PR 5 (W6-CDX-42): `OIDC_PROVIDER_NAME` is unset. The plan says `OIDC_PROVIDER_NAME` exactly. Decided pending Kyle.
- PR 5 (W6-CDX-42): the accent and the preferred editor too. Decided pending Kyle; the removal is limited to density and the sidebar default.
- PR 5 (W6-CDX-42): named the account writes only. Login with a password is refused as well (decided pending Kyle, security-first: the login

### From W6-CDX-44 (2026-10-12)

- **The header's theme control is a direct switch, not a popover.** The spec and plan name an icon button whose
  accessible name says the theme it switches to. Cloud Command's Appearance control is a popover that also holds
  Match system and the accents (its W6-CMD-43, itself decided pending Kyle). Codex keeps the plan's shape: Match
  system and the accent picker live in Appearance on the Account page. Parity of the control is open.
- **The header toggle appears on every page that renders a page header, and on no signed-out page.** The sign-in
  front door has no page header, so a visitor who has not signed in cannot switch the theme before signing in. The
  preference still applies there from the stored value.
- **`data-accent` carries presence only, not the accent name.** The pre-paint script sets an empty value, and the
  CSS tests only for the attribute. W6-CDX-43 had written the name; the change keeps the pre-paint script and the
  module identical.
- **Held writes still apply to the page at once.** The spec's order puts the document last, after the stores. The
  module applies the choice to the page immediately and holds the cookie and localStorage writes until the preference
  domain is known. A failed domain read drops the write (nothing is written host-only), and the page reverts on the
  next load.
- **The APP_URL check defaults to `http://localhost:3000` when APP_URL is unset,** the same default the server uses
  (`routes/helpers/shared.js`), so the domain check is never skipped.
- **The light hover on the header toggle is a small step.** Measured on the local stack: the ghost hover is 0.023
  OKLab L off the page surface in light and 0.025 in dark. Both differ; the light step is subtle.
- **"Match system" wraps to two lines in the Theme group at 390 px.** The label is the spec's. Cloud Command shortens
  its visible label to "System" and keeps "Match system" as the accessible name. Kyle may prefer the shorter label.
- **The round trip to the sibling product was not run.** The Codex captures are in
  `docs/research/suite-theme-switch-2026-10-12/`. A theme chosen in Codex has not been seen applied in Cloud Command
  on a shared parent domain; that check waits for both products on the test box.

## 5. The spec's live sections, carried whole

These are the spec's own sections that still describe the code or bind a sibling. Copied unchanged. The spec's
per-session "in scope, tests first, done means" blocks are not carried: they described the work, which is done, and
the deleted files remain in git history at the commit before this retirement.

### 5.1 The decisions this spec records (K1 to K10, and the decisions taken to carry them out)

## Decisions this spec records

Kyle's ten decisions of 2026-10-11 (K1 to K10), and the decisions this spec takes to carry them out.

1. **K1. The suite shell pattern: sidebar-led, no top bar.** The suite cluster, the workspace slot,
   the search trigger, the navigation and the account all live in one full-height sidebar, and each
   route has its own page header in the work area. The top bar and the copyright footer go. The
   pattern, in words: a 248 px sidebar on the sunken surface; top to bottom, the suite cluster (the
   product mark on a 24 px accent-fill tile, the product name in Inter 500 at 14 px, the suite name as
   an eyebrow, a chevron), the workspace slot (an initials tile, the workspace name, a secondary line),
   a "Search or jump to" trigger with a Ctrl K hint, the primary navigation, uppercase 12 px group
   labels over grouped items, and the user in the footer (an avatar, the name, the sign-out). A nav
   item is 14 px Inter with a 14 px stroke icon; the active item is the selection wash plus a 1 px
   inset accent ring. A page header holds a Poppins 24 px title, a faint meta line, the page's one
   primary action and the theme toggle, with a tab row under it where the page has sections.
2. **K2. Phones use the suite's two-row top strip.** Below 600 px (`max-width: 599px`) the sidebar
   becomes a top strip: row one the suite cluster, the workspace slot (it ellipsises) and the search
   trigger; row two the navigation, from the left edge, scrolling sideways; the account row after
   them. **The bottom tab bar goes.** Search is reachable on a phone again.
3. **K3. Codex gets a light theme.** The deferred editor canvas, comments and GitHub surface (the
   UI-later row in the roadmap) get a **colour-only** pass: light values, and no change to any
   geometry property, so comment highlights and remote cursors, which are positioned from the
   editor's DOM rectangles, do not move.
4. **K4. One suite-wide theme preference.** Switching light or dark in either product applies to
   both. The mechanism is the suite preference contract below; the sibling product implements the
   same contract, byte for byte where it is written as such.
5. **K5. Notifications are a sidebar nav item with an unread count,** in place of the top-bar bell.
   The Notifications page stays.
6. **K6. In suite mode, name, email, password and two-factor are read-only** for an account whose
   sign-in the issuer manages, "managed by" the issuer's display name with a link to where it is
   managed. The server refuses the same writes, so the read-only is not cosmetic.
7. **K7. The accent picker stays, re-based to store a hue,** so each theme derives its own steps and
   the picker works in light mode. The sibling product gains the same picker; both read one suite
   accent preference (the contract below).
8. **K8. Codex keeps the editor font size preference.** Density and the sidebar-collapse default go
   away. The preferred-editor choice (rich text or Markdown) is not an appearance preference and is
   not affected.
9. **K9. Codex's Workspaces page is hidden in suite mode,** because an instance is 1:1 with a
   sibling workspace (2026-09-24). Outside suite mode it stays, restyled.
10. **K10. Codex's page glyph on the accent tile replaces the cloud logo image** in the suite
    cluster and as the product mark on standalone screens.
11. **Neutrals stay consumer literals.** `cloud-city-design` declares literal primitives on `:root`
    only and no neutrals (`core.css`, its header's no-alias rule), so the light and dark neutral
    values are Codex `--cx-` literals, equal to the suite pattern's. Parity is pinned by a fixture,
    `tests/design/suite-theme.json`, that restates the table in "The light theme, token by token"
    and that `codex.css` must match. Lifting neutrals into the package is deferred (below).
12. **Values in, hover fills out.** The dark field darkens to the suite pattern's values, and the
    two hover fills retire: computed, the pattern's faint text falls under 4.5:1 on any dark hover
    fill lighter than L 0.22 (4.34 at L 0.24), and on light needs L 0.96 or lighter. A hover becomes
    the panel surface on a sunken row, or a strong-hairline change on a card. This is W6-CDX-38's
    work, not a later session's, because the darker values cannot ship with the old fills.
13. **The theme is resolved before first paint** by an inline script in `index.html`, allowed in
    production by its SHA-256 in `script-src`. A file under `public/` is not an option: that
    directory is the uploads directory the `app_public` volume shadows
    (`docs/maps/build-test-and-ops.md`, section 6b). A test pins the hash to the script's bytes in
    both `index.html` and the built `dist/index.html`.
14. **The Toast stays the suite's shared toast primitive (D-V, unchanged)** and moves to the bottom
    right, where no navigation can sit under it now that the top bar is gone.
15. **Class names are kept wherever a surface is restyled rather than rebuilt,** so tests that select
    by class survive. Where a surface is rebuilt (the shell, the admin tabs), its tests are rewritten
    in the same PR, tests first.

Decision D-V of 2026-09-24 kept Codex dark-only through Wave 6. **K3 and K4 supersede that half of
D-V**; its other half, the Toast as the shared primitive, stands.

---

### 5.2 The light theme, token by token

The fixture `cloudcodex/tests/design/suite-theme.json` restates this table, and `codex.css` must equal the fixture.

## The light theme, token by token

`codex.css` gains a `[data-theme='light']` block beside `[data-theme='dark']`, and the bindings that do
not change with the theme (the Google brand colours, solid white and black, layout sizes, motion) move
to a bare `[data-theme]` block both themes match. The values below are the suite pattern's, so the
two products' neutrals match exactly; `tests/design/suite-theme.json` holds this table and
`codex.css` must equal it.

| Codex token | Dark (from W6-CDX-38) | Light (W6-CDX-43) | Source |
|---|---|---|---|
| `--cx-surface-0`, the page | `oklch(0.17 0.012 240)` | `oklch(0.985 0.002 230)` | Codex literal |
| `--cx-surface-1`, sidebar and wells (sunken) | `oklch(0.145 0.012 240)` | `oklch(0.962 0.004 230)` | Codex literal |
| `--cx-surface-2`, cards, panels, menus, dialogs | `oklch(0.21 0.014 240)` | `oklch(0.995 0.003 230)` | Codex literal |
| `--cx-surface-3`, `--cx-surface-4` | retired (Decision 12) | none | |
| `--cx-border`, card hairline | `oklch(0.3 0.015 240)` | `oklch(0.9 0.006 230)` | Codex literal |
| `--cx-border-strong`, controls (new) | `oklch(0.38 0.016 240)` | `oklch(0.82 0.01 230)` | Codex literal |
| `--cx-text-primary` | `oklch(0.93 0.005 230)` | `oklch(0.24 0.015 240)` | Codex literal |
| `--cx-text-secondary` | `oklch(0.72 0.01 235)` | `oklch(0.45 0.015 240)` | Codex literal |
| `--cx-text-faint` | `oklch(0.61 0.012 238)` | `oklch(0.54 0.012 240)` | Codex literal |
| `--cx-accent` | `var(--accent-400)` | `var(--accent-600)` | package |
| `--cx-accent-hover` | `var(--accent-300)` | `var(--accent-700)` | package |
| `--cx-accent-fill` | `var(--accent-400)` | `var(--accent-400)` | package |
| `--cx-on-accent` | `oklch(0.14 0.03 240)` | `oklch(0.16 0.03 240)` | Codex literal |
| `--cx-select-wash` (new) | `oklch(0.21 0.055 240)` | `oklch(0.97 0.025 230)` | Codex literal |
| `--cx-danger` (text) | `var(--danger-bright)` | `var(--danger-deep)` | package |
| `--cx-success` (text) | `var(--success-bright)` | `oklch(0.5 0.13 150)` | package / Codex literal |
| `--cx-warning` (text) | `var(--warning-bright)` | `oklch(0.5 0.11 78)` | package / Codex literal |
| `--cx-info` | `var(--accent-400)` | `var(--accent-600)` | package (fixed, not the picker) |
| `--cx-danger-fill`, label `--cx-on-accent` | `var(--danger-bright)` | `var(--danger-bright)` | package |
| `--cx-scrim` | `oklch(0.12 0.02 240 / 0.5)` | same | Codex literal |
| `--cx-shadow-sm` | `0 1px 2px oklch(0 0 0 / 0.3)` | `0 1px 2px oklch(0.2 0.02 240 / 0.06)` | Codex literal |
| `--cx-shadow-md` | `0 4px 16px oklch(0 0 0 / 0.4)` | `0 4px 16px oklch(0.2 0.02 240 / 0.1)` | Codex literal |
| `--cx-focus-ring` | `var(--cx-accent)` | `var(--cx-accent)` | |
| `--cx-radius-*` | deleted: core's `--radius-sm/md/lg` (6, 10, 14 px) | same | package |

Notes the sessions act on:

- **Status text in light.** The package's `--success-deep` and `--warning-deep` measure 3.65 and 3.66
  on the light surface (computed): fine as a 3:1 signal, failing as 4.5:1 text, and Codex uses them as
  text (form messages, toast labels). Hence Codex's own L 0.5 values (computed 5.57 and 6.01). This
  is a Codex binding, not a package change. `--danger-deep` passes on the sunken surface at 4.79, with
  little margin, so danger text stays off hover fills.
- **The danger fill** adopts the pattern's model: `--danger-bright` with the dark ink (computed
  5.06:1), and a hover that is an inset ring, not a darker fill. `--cx-danger-fill-hover`,
  `-press`, `--cx-on-danger` and `--cx-accent-dark` retire when their last reader goes.
- **Washes.** The 22 `--cx-tint-*` washes and four bright labels (`codex.css:82-122`) collapse to
  accent, success, warning and danger washes plus `--cx-select-wash`. In light, labels on a wash flip
  to deep values: the dark labels measure 1.27 to 1.41 on a light wash (computed), `--accent-700`
  7.79.
- **Code blocks** get a light syntax palette, measured over the light surfaces by
  `tests/design/code-blocks.test.js` in both themes.
- **The deferred families** (editor canvas, comments, GitHub; the 399 ledger findings at `f0bc965`)
  get light values by tokenising each literal colour into a `--cx-` binding whose dark value is the
  literal it replaces, so dark is unchanged and light is new. A geometry fingerprint test (the plan,
  Task 6.1) pins every non-colour declaration in those banners, so the pass provably moves nothing.
  The comments panel's `backdrop-filter` (`index.css:7051`) is paint, not colour, and stays for
  UI-later.
- **Undeclared names read with literal fallbacks** (13 names, about 35 sites, such as `--bg-primary`
  with `#121212` and `--accent` with `#7c3aed`) are declared or bridged in W6-CDX-38, or they paint
  dark literals in the light theme. `--editor-font-size` is set by script and stays.

---

### 5.3 Ordering constraint, and defects with an owner

## Ordering constraint

```
W6-CDX-37 (this spec and plan)
     │
W6-CDX-38 (neutrals, base, hover model) ──► W6-CDX-39 (controls, Toast) ──► W6-CDX-40 (the shell)
                                                                               │
                                                     ┌─────────────────────────┤
                                                     ▼                         ▼
                                     W6-CDX-41 (lists, home, doc header)   W6-CDX-42 (settings, admin)
                                                     │                         │
                                                     └──────────┬──────────────┘
                                                                ▼
                                                     W6-CDX-43 (light tokens, the hue picker)
                                                                ▼
                                                     W6-CDX-44 (the theme switch, the contract) ──► W6-CDX-36 (the release)
```

W6-CDX-40 rebases on the open fix `fix/suite-switcher-and-dead-session` (the switcher under the
docked sidebar, and a dead session that never reached the front door) once it merges, and keeps its
dead-session wiring (`src/lib/session-ended.js` and the layout's front door) intact while it replaces
the layout around it. W6-CDX-41 and W6-CDX-42 are independent of each other. **Every session is on
the release path:** W6-CDX-36 waits on W6-CDX-44.

## Defects, and who fixes them

Each defect is fixed in the session that owns its surface, tests first.

| # | Defect, at `f0bc965` | Owner |
|---|---|---|
| X1 | The docked sidebar and the top bar tie at `--z-sticky` (`index.css:139-161`, `:342-352`), so the suite panel opens under the sidebar at 1280 and a scrolled sidebar covers the top bar | Fixed by `fix/suite-switcher-and-dead-session` (not duplicated here). W6-CDX-40 removes the top bar, so it cannot recur, and rewrites `tests/design/z-index.test.js`'s layering for the new shell |
| X2 | The first toast after a page load is dropped: `showToast` mounts the container and calls `addToastFn` before the container's effect has assigned it (`components/Toast.jsx:29-31`, `:51-54`) | W6-CDX-39 |
| X3 | Admin error toasts lose the server's message: `AdminPage.jsx:329`, `:385`, `:823` pass a string to `toastError`, which reads `err.body.message` or `err.message` (`Toast.jsx:37-44`) | W6-CDX-39 (`toastError` accepts a string, and the three call sites pass the error) |
| X4 | Buttons and native fields paint the browser's font: `.btn` and the inputs set no `font-family` or `font: inherit` | W6-CDX-38 |
| X5 | The first-run dialog centres its list and paints its link in the user agent's link colour | W6-CDX-42 |
| X6 | The account menu dims the page behind it. Re-diagnosed: the dimming is the modal scrim (`showDropdownMenu`, `util.jsx:602-614`, over `#modal-dimmer`), not a blur; the blurred `#dropdown-backshadow` rule (`index.css:1340-1347`) has no emitter and is dead | W6-CDX-40 (a non-modal footer menu, no scrim; the dead rule and its pin in `leftover-burndown.test.js` go) |
| X7 | The Users table shows an unlabelled `0` after each Permissions button | W6-CDX-42 |
| X8 | Revoke on an invitation acts at once, with no confirmation (`AdminPage.jsx:818-825`) | W6-CDX-42 |
| X9 | Solid red Delete buttons repeat on every archive card | W6-CDX-41 (row actions in a More actions menu); W6-CDX-39 gives danger its one look |
| X10 | `.toast--info` has no rule | W6-CDX-39 |
| X11 | No `color-scheme`, so native controls paint light chrome on dark | W6-CDX-38 (dark), W6-CDX-43 (light) |
| X12 | Emoji as icons in the admin console and the document header | W6-CDX-42 (admin), W6-CDX-41 (document header) |
| X13 | No search on a phone | W6-CDX-40 |

---

### 5.4 Cross-repo dependencies and the deferred list

## Cross-repo dependencies

| This session | Needs, or is needed by, the sibling product | Notes |
|---|---|---|
| W6-CDX-38 to W6-CDX-43 | nothing | the targets are the written pattern and the tables above |
| W6-CDX-44 | W6-CMD-43 implements the same contract | either can land first: a product that honours the contract reads whatever the other wrote; the round trip is proved once both are on the test box |
| W6-CDX-36 (the release) | W6-CMD-38 (the full-box rehearsal) waits on it | unchanged, but W6-CDX-36 now waits on W6-CDX-44 |

## Deferred

- **Lifting the neutrals and the per-theme values into `cloud-city-design`.** The package's rule is
  literals on `:root` only and no theme selectors; until a package version carries a neutral ramp,
  both products hold the same literals, pinned by fixtures. The same goes for the eight hues, which
  the contract states and both products copy.
- **Geometry in the editor canvas, comments and GitHub surface** (UI-later): still deferred. This
  track touches their colours only.
- **The core spacing, type and motion scales everywhere.** Each session adopts them on the surfaces
  it rebuilds; there is no mass replace.
- **Instance branding** (the hard-coded "Cloud Codex" strings).
