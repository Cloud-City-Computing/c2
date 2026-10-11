# W6-CDX-22: the palette on the tokens, and the accent picker

Captured 2026-10-10 with `iris shoot` against Codex's Vite dev server, with
`/api` answered by a canned mock (no database). The signed-in shell, the
Account page and the Appearance picker are real. The danger button, the
notification badge and the avatar initials are real CSS on real classes, but
their markup is added by the capture harness (the data behind them needs a
database). Archive, document and admin pages were not captured. Captures are
1280 px wide (`iris shoot` has no width flag, so the 390 px pass is not done).

Before is origin/main, served from a `git archive` copy. After is this branch.
Hover states are not in the captures (`iris shoot` cannot hover); the hover
step is measured in `tests/design/painted.test.js` instead.

## What to look at

- `after/cdx22-after-labels-default.png` and `before/cdx22-before-labels-default.png`:
  the primary button and the danger button side by side. Primary now carries a
  dark ink on the pale accent fill, where main had white on a gradient.
  Danger is a deeper red than main's `#e54545`, so white clears 4.5:1.
- `after/cdx22-after-labels-iris.png`: the same strip under the placeholder iris accent (final name Nebula). The
  primary label is dark ink on periwinkle, and the danger button stays red.
- `after/cdx22-after-labels-coral.png`: the avatar initials under the placeholder coral accent (final name Nova). The
  avatar fills with the picked accent's dark step, and its white initial is
  readable.
- `after/cdx22-after-home.png`, `after/cdx22-after-picker-*.png` against
  `before/cdx22-before-picker-*.png`: the old eight swatches and the new eight.
  The new set is paler, since every hue sits at L 0.78.

## Measured (vendored gate, `tests/design/painted.test.js`)

| Pair | Sites | Minimum over default and 8 hues | Maximum | Main |
|---|---|---|---|---|
| ink (`--cx-on-accent`) on accent fill | 5 | 6.30:1 (Nova) | 7.24:1 | white on the fill: 2.68 to 3.07:1 |
| white on accent dark (avatars) | 3 | 6.48:1 (cyan) | 8.01:1 | white on `accent-600`: 6.12:1 (fixed, did not follow the accent) |
| white on danger rest | 3 | 6.63:1 | | 3.99:1 (`#e54545`) |
| white on danger hover | 2 | 8.27:1 | | (main had no separate hover step) |

The hover is darker than rest (relative luminance), as the test asserts.

## The eight hues (OKLCH, rendered hex)

| key | name (placeholder) | OKLCH | hex |
|---|---|---|---|
| blue | Ocean Blue (kept) | oklch(0.78 0.12 232) | #5cc5f7 |
| cyan | Cyan (kept) | oklch(0.78 0.12 200) | #3aced6 |
| pink | Fuchsia (kept) | oklch(0.78 0.12 325) | #de9ce2 |
| lime | Lime (kept) | oklch(0.78 0.12 131) | #9cc774 |
| Nova (was rose; placeholder coral) | Nova | oklch(0.78 0.12 355) | #f496bb |
| Solar (was amber; placeholder apricot) | Solar | oklch(0.78 0.12 50) | #f5a06f |
| Aurora (was emerald; placeholder jade) | Aurora | oklch(0.78 0.12 175) | #52d0b3 |
| Nebula (was violet; placeholder iris) | Nebula | oklch(0.78 0.12 275) | #a1b1ff |

Text contrast of each hue on the five dark surfaces: worst 4.61:1 (Nova on
`--cx-surface-4`), best 8.78:1 (Aurora on `--cx-surface-0`). 40 of 40 pairs clear
4.5:1.
