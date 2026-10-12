# Suite UI alignment track: one family, a light theme, and one suite-wide preference

Agreed 2026-10-11. Every `file:line` claim below was re-derived against `origin/main` `f0bc965`
(W6-CDX-29, where the suite UI track retired). Contrast numbers marked **computed** come from the
OKLCH values by WCAG 2.x arithmetic, not from a browser, and the session that acts on each re-measures
it through the design gates rather than trusting it here.

- **Track:** Wave 6 suite, UI alignment. Sessions W6-CDX-38 to W6-CDX-44. This document and its plan
  are W6-CDX-37.
- **Plan:** [`../plans/2026-10-11-suite-ui-alignment.md`](../plans/2026-10-11-suite-ui-alignment.md)
- **Requested by:** Kyle, on 2026-10-11, recorded in the Cloud Command ADR
  `codex-aligns-with-command-before-the-wave-6-release.md` (a private repository; every decision that
  binds this repository is restated below). The evidence is an audit of both products' interfaces,
  surface by surface, at both widths, taken the same day against this tree at `f0bc965`. The audit
  and its captures stay in the private repository because half of them show the other product; this
  spec carries its findings as text.

## Why this spec exists

The suite UI track (W6-CDX-21 to W6-CDX-29) put Cloud Codex's **colour values** on the shared
`cloud-city-design` tokens. It did not align **structure, anatomy, spacing, type scale or theme**,
and those are why the two products still read as cousins rather than one family. Kyle decided on
2026-10-11 that Codex closes that gap **before** the Wave 6 Codex release (W6-CDX-36): the shell, the
shared controls and the content surfaces move to the suite shell pattern, and Codex gains a light
theme, switched by one preference that both products honour.

The rule for sharing is unchanged: **primitives are matched, not shared.** The token package is the
one shared artifact; each product builds its own components against it. Where this spec says "the
suite shell pattern", it means the written anatomy below, which the sibling product already
implements; nothing from that product's code enters this repository.

Like every Wave 6 change, the visible change is either Kyle-approved (the shell, the light theme)
or off by default (everything that names the suite, which needs suite mode). A self-hoster with no
`SUITE_*` variable gets the new shell and the theme switch, and no suite cluster.

## Current behaviour, the starting point

**Neutrals.** `src/codex.css:35-39` declares five surface steps from `oklch(0.234 0.014 240)` to
`oklch(0.386 0.014 240)`, about a full step lighter than the suite pattern's dark field. Text tiers
are compressed (`codex.css:43-45`: L 0.92, 0.84, 0.77). Radii are overridden to 4, 8 and 12 px
(`codex.css:144-146`) where core declares 6, 10 and 14 (`vendor/cloud-city-design/core.css`). The
legacy bridge (`src/index.css:12-83`) repoints 27 names plus five fallback names; `--bg-hover`
(27 uses) and `--bg-hover-strong` (2) are fills on `--cx-surface-3` and `--cx-surface-4`.

**Scales.** Codex reads the shared scales for colour and z-index only. `--space-*`, `--text-*`,
`--leading-*`, `--dur-*` and `--avatar-*` have no uses; `index.css` (9,193 lines) holds roughly 356
literal `font-size`, 119 `font-weight`, 681 spacing and 59 `transition` values.

**No light theme.** `index.html:8` pins `data-theme="dark"`; every declaration in `codex.css` sits
under `[data-theme='dark']` (`codex.css:30`), which `tests/design/codex-css.test.js` asserts. There is
no `prefers-color-scheme` read and no `color-scheme` property, so native selects and scrollbars paint
light chrome on the dark page.

**The shell.** `src/page_layouts/Std_Layout.jsx`: a collapsible `Sidebar` (`:140`), a full-width
`TopBar` (`:172`) holding the suite cluster, a 480 px search, the bell and the account button, a
`MobileNav` bottom tab bar (`:219`) at 768 px and below, and a copyright `footer` (`:404`). The
sidebar's collapse default comes from the preferences (`:272`). Search is hidden at 768 px and below,
so a phone has no search. The suite cluster's mark is the company logo image
(`src/components/SuiteCluster.jsx:151`), not a product glyph.

**Preferences.** `src/userPrefs.js`: one localStorage key, `c2-user-prefs` (`:16`); the accent picker
writes **finished dark colours** inline on the root (`:72-83`), so it would override any light block;
`FONT_SIZES` (`:50`), `DENSITIES` (`:56`) and the sidebar default (`:99-103`). The Appearance panel is
`UserPreferencesPanel` (`src/components/AccountMenu.jsx:552`). The eight hues and their step
formulas live in `src/tokens/accents.js:16-33`.

**Security headers.** In production one helmet policy covers every response, with
`script-src 'self'` (`app.js:306-334`). An inline script needs its hash in that directive.

**Defects found by the audit,** routed to the session that owns each surface (see "Defects, and who
fixes them" below for the list and the anchors).

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

## The suite preference contract (version 1)

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
  | Selection wash | `oklch(0.21 0.055 H)` | `oklch(0.97 0.025 H)` |

  These are the package ramp's own shapes (`--accent-400`, `-300`, the light text step the audit
  measured at L 0.47, `--accent-700`'s shape) with the hue swapped, so the default and a picked hue
  differ only in hue. Computed: the light text step measures at least 4.81:1 on every proposed light
  surface for all eight hues, and the fill carries the dark ink at about 6.9:1. **Each product's
  gates must prove, for all eight hues and both themes:** the text step at 4.5:1 or more on every
  surface it paints, the fill's label at 4.5:1 or more, and the focus ring at 3:1 or more. If either
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

## W6-CDX-38. Neutrals, base and the hover model

### In scope

- The dark neutrals, text tiers, accent, status text, scrim, shadows and radii of the table above,
  in `codex.css`, split into a bare `[data-theme]` block and a `[data-theme='dark']` block.
- The hover model (Decision 12): each of the 27 `--bg-hover` and 2 `--bg-hover-strong` uses moves to
  the panel surface on a sunken row or a `--cx-border-strong` change on a card; then
  `--cx-surface-3` and `--cx-surface-4` and their two bridge names are deleted.
- `--cx-border` splits into the card hairline and `--cx-border-strong` for controls.
- `color-scheme: dark` in the dark block (X11).
- `font: inherit` on `.btn`, `input`, `select`, `textarea` and `button` (X4).
- The 13 undeclared fallback names declared or bridged.
- `tests/design/suite-theme.json` (dark half), and a test that `codex.css` equals it.

### Tests first

- `suite-theme.test.js`: every dark row of the fixture equals the declaration in `codex.css`; red on a
  one-digit change to any value.
- `codex-css.test.js`: exactly the selectors `[data-theme]` and `[data-theme='dark']`; no
  `--cx-radius-*`; no `--cx-surface-3` or `-4`.
- `contrast.test.js` and `pairs.json`: the matrix over the three surfaces plus the selection wash;
  faint text on every surface at 4.5:1; red when `--cx-text-faint` is lifted onto a hover fill at
  L 0.24.
- `bridge.test.js`: the two hover names gone, `--radius-*` no longer redeclared by the bridge.
- A token-discipline check that no rule outside the deferred families reads `--bg-hover` or
  `--bg-hover-strong`.
- A render test that `.btn` and a native `select` compute `font-family` from `--font-ui` (asserting
  the declaration, since jsdom does not substitute `var()`).

### Done means

Every existing pair passes on the new values; no ledger bucket rises; captures at 1280 and 390, dark,
of home, an archive, a document, Account and Admin, read and described beside the suite pattern; the
document page with two cursors and one comment shows highlights in place.


**Recorded at execution (W6-CDX-38).** Three choices the spec did not spell out, each in the plan's deviation list: the danger fill moved with its label and hover (a white label on the bright fill fails 4.5:1), so the danger button's inset-ring hover landed here; a hover on a row inside a panel is the sunken well, since a border-colour hover gives a borderless row nothing; and X4 inherits the typeface only (`font-family`), because the `font` shorthand moved the top-bar search field from 31px to 36px.

---

## W6-CDX-39. Controls, the Toast and dialog panels

### In scope

- **Buttons** on the pattern's anatomy: 30 px high, `--radius-md`, Inter 500 at 13 px, no
  letter-spacing; primary on `--cx-accent-fill` with the dark ink; secondary a 1 px
  `--cx-border-strong`; ghost; a 30 px icon button with a 44 px hit area; danger on
  `--cx-danger-fill` with the dark ink and an inset-ring hover. Class names kept.
- **Fields**: one field primitive (an uppercase 12 px faint label, the input on the sunken surface with
  a 1 px strong hairline, `--radius-md`, hint and error lines), applied to the most visible families
  first; the sort, squad and role selects become a trigger and a menu.
- **One menu primitive** with a correct role contract (`role="menu"` with `menuitem` children, or a
  disclosure of links), replacing the search dropdown, the export menu and the GitHub sync menu's
  look. The suite panel stays a disclosure (W6-CDX-25).
- **Tabs**: one tab row (24 px gap; active is `--cx-text-primary`, weight 500, a 2 px inset accent
  underline).
- **Chips and badges** on the pattern's chip (a pill, a state dot, a 12 px floor); **avatars** on
  core `--avatar-1..8` tints from a stable hash with dark initials; **icons** one stroke set at 14 to
  15 px, never emoji.
- **The Toast**: X2 and X3 fixed; the stack at the bottom right; the message in
  `--cx-text-primary` with the status carried by the icon and the edge; `.toast--info` (X10).
- **Dialog panels** on `--cx-surface-2`, `--cx-border-strong`, `--radius-lg`, a Poppins title and
  Inter body. Destructive confirmation copy names what is lost.

### Tests first

- `Toast.test.jsx`: the **first** `showToast` after a fresh module load renders a toast (red at
  `f0bc965`); `toastError('a string')` shows that string; `toastError` of an error with
  `body.message` shows that; `.toast--info` exists in the stylesheet.
- `AdminPage` tests: a failing revoke whose server body carries a message shows that message.
- A menu primitive test: roles, arrow keys, Escape returns focus, an outside click closes.
- Design gates: the Buttons, Toast, tabs and chips banners have zero findings; the danger fill's label
  measures at 4.5:1.

### Done means

Captures of every control family on real screens at 1280 and 390, dark; the Toast shows on the first
call; class-selecting tests are unchanged except where a rebuilt control's test is rewritten in the
same PR.

---

## W6-CDX-40. The suite shell

### In scope

- **The layout (K1).** `Std_Layout.jsx` becomes the sidebar-led shell: the suite cluster (suite mode
  only; outside it, the product mark and name in the same slot), the workspace slot, the search
  trigger, the nav, groups, and the user footer. The top bar, its 2 px gradient and the copyright
  footer go. Each route renders a page header (a shared component: title, faint meta, one primary
  action, the theme toggle slot that W6-CDX-44 fills, an optional tab row).
- **The workspace slot.** In suite mode it shows the instance's workspace name, read-only, and the
  suite cluster's "All workspaces" is the way to the sibling's picker. Outside suite mode it is the
  current workspace with a link to the Workspaces page.
- **Navigation.** Home and Activity are primary items; **Notifications is a nav item with an unread
  count pill (K5)** fed by `useNotificationChannel`; Archives becomes a group listing the archives;
  GitHub stays an item; Account and Admin move to the footer menu. **Workspaces is absent in suite
  mode (K9),** and `/workspaces` and `/workspaces/:workspaceId` redirect to `/` in suite mode.
- **The account footer.** Avatar, name (it ellipsises and never cuts to one letter at 248 px), and
  sign-out; the name opens a small non-modal menu with Account settings and sign-out, no scrim (X6).
  The bell dropdown and the `showDropdownMenu` account menu go; the dead `#dropdown-backshadow` rule
  goes.
- **Search (X13).** A "Search or jump to" trigger with a Ctrl K hint opens a centred palette listing
  documents and archives, built on the existing search API; reachable at every width.
- **The product mark (K10).** The page glyph (an outlined document page, drawn as an inline SVG in
  `--cx-on-accent`) on a 24 px `--cx-accent-fill` tile replaces the logo image in `SuiteCluster.jsx`
  and on the signed-out and not-found screens.
- **Phones (K2).** At `max-width: 599px` the two-row top strip; the bottom tab bar
  (`MobileNav`) and its CSS go.
- **The sidebar collapse goes (K8):** the toggle, `collapsed` state and the `data-sidebar-default`
  read (`Std_Layout.jsx:272`).
- **The editor keeps its width.** The doc page's content column keeps its width at 1280, so the editor
  container moves and never resizes.

### Tests first

- Std_Layout tests: no `header.topbar`, no `footer.log-footer`, no `nav.mobile-nav`; the sidebar
  holds, in order, the cluster or product mark, the workspace slot, the search trigger, the nav and
  the footer.
- Suite on: no Workspaces item, and `/workspaces` redirects to `/`; suite off: the item is present.
- The Notifications item's accessible name carries the unread count, and the pill reads `99+` above
  99.
- The footer menu: opens on the name, closes on Escape with focus back on the name, no element with
  `#modal-dimmer` shown.
- The search palette: Ctrl K opens it, Escape closes it, results list documents and archives.
- `SuiteCluster.test.jsx`: the mark is an SVG, not an `img`.
- The dead-session tests from `fix/suite-switcher-and-dead-session` pass unchanged.
- `z-index.test.js` rewritten for a shell with no top bar, with its non-vacuity floor.

### Done means

Every route renders in the new shell at 1280 and 390 with no overlap, dark; the switcher panel opens
inline; a manual smoke of a document with two cursors and a comment shows highlights in place before
and after, recorded with captures.

*Decided at execution (W6-CDX-40, 2026-10-12):* the sidebar is 248 px with an 18 px inline main padding, so the
document column keeps its 996 px at 1280; the footer menu is an action menu, not the radio `Menu`; the phone
account is an avatar in the strip's second row; the workspace slot shows the user's first workspace (pending Kyle);
the page header is adopted on Account, Notifications, Notification preferences and Activity, with the other pages
in PR 4 and PR 5. **Known deviation, decided pending Kyle:** the workspace slot shows the first workspace the user can
see, because the code has no "current workspace" state outside suite mode. The full list is in the plan's PR 3 section. Only the single-browser comment capture was taken;
the two-cursor smoke is open.

---

## W6-CDX-41. Lists, home and the document header

### In scope

- **Home:** the hero goes; a page header (title, faint meta such as "12 documents"); one search entry,
  not two; the document grid on the pattern's card (surface, hairline, `--radius-md`, hover by
  border).
- **Archives (X9):** rows (name, squad, owner, counts), with Rename, Manage access and Delete in a More
  actions menu; New Log the page's one primary.
- **The archive view and doc tree:** the tree on the nav-item anatomy, the archive header on the page
  header; the tree keeps its width so the editor column does not resize.
- **The document header:** title, meta in faint text, the author's name rather than email, star and
  watch as icon buttons, Edit as the one primary, stroke icons in place of emoji (X12). The editor
  toolbar and canvas are not touched.
- **Workspaces (outside suite mode), Activity and Notifications pages:** full content width, the tab
  row, activity rows on the avatar tints with names in primary text, links in the accent, time faint.
- **Empty states:** one component (Poppins 18 px title, one line, an optional action), everywhere.

### Tests first

- No list renders a per-row danger button (a render test over Archives).
- One empty-state component: Home, an empty archive, Notifications and Activity each render it.
- The document header shows the author's name, not the email, and has one primary button.
- `git diff --stat` on `src/pages/Editor.jsx` stays at the header mount (the canvas is untouched).

### Done means

Captures of Home, Archives, an archive with its tree, a document, Workspaces (suite off), Activity
and Notifications at 1280 and 390, dark, described beside the suite pattern; the two-cursor smoke
passes.

---

## W6-CDX-42. Settings, admin, not-found and first run

### In scope

- **Account settings** on the pattern's settings card (uppercase label, body, one action).
- **Read-only identity in suite mode (K6).** For an account with a `user_identities` row, in suite
  mode, the name, email, password and two-factor panels render read-only with the line "Managed by
  <name>" and a link, where `<name>` is `OIDC_PROVIDER_NAME` (on the test box, the issuer's display
  name) and the link is a new optional `OIDC_ACCOUNT_URL` (no link when unset). The suite's name is
  configuration, never a source literal (`tests/design/suite-name.test.js`). The server refuses
  `POST /api/update-account`, `POST /api/update-account/confirm-email` and the `/api/2fa/*` writes for
  the same accounts with a named refusal, `managed_by_issuer`. Accounts with no issuer identity (a
  local boot admin) stay editable.
- **Appearance (K8):** density and the sidebar default are removed from the panel, from
  `userPrefs.js` (`DENSITIES`, `applyPrefsToDOM`'s density and sidebar branches) and from the three
  `--density-scale` reads; a stored `density` or `sidebarDefault` key is dropped on load. The editor
  font size and the preferred editor stay. The theme choice arrives in W6-CDX-44.
- **Admin:** sections become a tab row in a page header (no inner sidebar, no emoji, X12); Overview
  becomes a quiet summary (numbers in primary text, no accent numerals); Users, Squads and Invitations
  on the pattern's member row; the unlabelled count goes or gets its label (X7); Revoke confirms,
  naming the invitation (X8).
- **Not found:** the standalone card (product mark, Poppins title, one line, one primary).
- **First run (X5):** a left-aligned list, links in the accent, one primary.

### Tests first

- Suite on, issuer-linked account: the four panels are read-only and show "Managed by" plus the
  configured name; with `OIDC_ACCOUNT_URL` set the link has that `href`; suite off: editable.
- Route tests: each refused write answers the named refusal for an issuer-linked account in suite
  mode, and is unchanged outside suite mode and for an account with no identity row.
- `env-contract.test.js` and `docs/getting-started.md`: `OIDC_ACCOUNT_URL` documented, optional,
  per-instance.
- `userPrefs.test.js`: no `DENSITIES` export; a stored `density` and `sidebarDefault` are dropped;
  the 95% line threshold holds.
- Admin: Revoke opens a confirm and calls the API only on confirm; no Users row renders a bare number
  without a label.

### Done means

Captures of Account (suite on and off), Admin's tabs, not-found and first run at 1280 and 390, dark;
admin has no emoji and no inner sidebar; Revoke confirms.

---

## W6-CDX-43. The light theme, and the hue-based picker

### In scope

- The `[data-theme='light']` block for every binding, per the table; `color-scheme: light`;
  `suite-theme.json`'s light half.
- Per-theme status text, the collapsed washes with deep labels in light, and the light code-block
  palette.
- **The picker writes a hue (K7):** `applyPrefsToDOM` sets `--cx-accent-h` and a `data-accent`
  attribute on the root; `codex.css` derives the four contract steps per theme under
  `[data-theme='dark'][data-accent]` and `[data-theme='light'][data-accent]`, and the default
  bindings apply without `data-accent`. No finished colour is written inline any more.
- **The deferred families' colour-only pass (K3),** behind the geometry fingerprint.
- Every design gate runs in both themes: `contrast`, `accents` (8 hues by every surface by two
  themes), `tints`, `painted`, `code-blocks`, `presence-palette`.
- May split at the deferred-family boundary into two PRs if the diff grows past review size; both
  are W6-CDX-43.

### Tests first

- `geometry-fingerprint.test.js` first, green at the start: a digest of every non-colour declaration
  in the editor, comments and GitHub banners. It must stay green through the session.
- `suite-theme.test.js`: the light half equals the fixture.
- `accents.test.js`: the CSS step expressions equal the contract table with H substituted, for both
  themes, and every pair passes; red if a light step is set to the dark one.
- `codex-css.test.js`: exactly the three selector forms plus the two `[data-accent]` forms.
- `userPrefs.test.js`: `applyPrefsToDOM` writes `--cx-accent-h` and `data-accent`, and never
  `--cx-accent`.

### Done means

Every gate passes in both themes; the fingerprint is unchanged; captures of every route at 1280 and
390 in dark and light (the theme set by attribute, since the switch lands next), including a
document with two cursors and a comment in light.

---

## W6-CDX-44. The theme switch, and the suite preference contract

### In scope

- **The pre-paint script** in `index.html`, implementing "Reading, and precedence" and "Applying" for
  both preferences, and its SHA-256 in `script-src` (Decision 13).
- **`src/lib/suite-prefs.js`**, the one module that reads, writes, clears, migrates and keeps open
  pages in step, exactly per the contract, awaiting the suite configuration before any write.
- **`SUITE_PREFERENCE_DOMAIN`**: boot validation, `env-contract.js` (optional, per-instance, honoured
  with `SUITE_COMMAND_WORKSPACE_URL`), `docs/getting-started.md`, `.env.example`, and
  `GET /api/suite`'s `preferenceDomain`.
- **The toggle** in the page header (the slot W6-CDX-40 left), an icon button with an accessible name
  naming the theme it switches to; **Appearance** gains Theme (Match system, Light, Dark), and the
  accent picker reads and writes through `suite-prefs.js`, with "Default" clearing it.
- **Migration:** a stored `c2-user-prefs` `accentColor` becomes `cc_suite_accent` once, and the key is
  removed from the prefs object.

### Tests first

- `suite-prefs.test.js` (jsdom): each precedence step wins over the ones below it; invalid values at
  every step fall through; a write with a domain in use sets the shared cookie, expires the host-only
  copy and sets localStorage; a write before the configuration resolves waits; clearing expires both
  forms and the key; `Secure` only on https; `Domain` only when `location.hostname` matches; the
  `visibilitychange` and `storage` paths re-apply.
- A test that runs the **inline script's own text** (read from `index.html`) against each precedence
  case and asserts `data-theme`, so the script and the module cannot drift apart.
- A CSP test: the SHA-256 of the inline script in `index.html` appears in `HELMET_OPTIONS`'s
  `scriptSrc`; after `npm run build`, `dist/index.html` carries the identical bytes; an app test in
  production mode finds the digest in the served header.
- Boot tests: each invalid `SUITE_PREFERENCE_DOMAIN` form named above fails the boot; a domain that
  `APP_URL`'s host does not end with fails; unset is fine.
- `GET /api/suite` returns `preferenceDomain` in suite mode with the variable set, and `null`
  otherwise.

### Done means

A first visit follows the OS; the toggle persists across reloads; a choice made in Codex on the local
three-host stack applies in the sibling product where cookies can be shared, and falls back to
per-product localStorage on `localhost`, both recorded; no flash of the wrong theme on a throttled
load (captured); captures of every route in both themes at 1280 and 390.

---

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

## Open questions for Kyle

None. Kyle's ten answers of 2026-10-11 settle the audit's questions. One reading is recorded rather
than asked: "keeps the editor font size preference only" is read as covering the three appearance
preferences the audit asked about (font size, density, sidebar collapse), so the preferred-editor
choice, a behaviour rather than a look, stays.

## Retirement

W6-CDX-44 updates the frontend-architecture and build-test-and-ops maps (the shell, the themes, the
contract, the gates), deletes this spec and its plan, removes their rows from
[`README.md`](README.md) and `docs/README.md`, and marks the UI alignment row in
[`roadmap.md`](roadmap.md) shipped.
