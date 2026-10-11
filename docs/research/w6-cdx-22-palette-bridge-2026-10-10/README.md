# W6-CDX-22: the palette on the tokens, and the accent picker

Captured 2026-10-10 with `iris shoot` against Codex's Vite dev server, with
`/api` answered by a canned mock (no database). The signed-in shell, the
Account page and the Appearance picker are real; archive, document and admin
pages need data and were not captured. Captures are 1280 px wide (`iris shoot`
has no width flag, so the 390 px pass is not done).

Before is origin/main at 538d1f6, served from a `git archive` copy; after is
this branch.

## What to look at

- `before/account-default-before.png` against `after/home-after.png`: the
  surfaces take the package's blue-grey tint, and the default accent is the
  package's blue step, a little lighter than the old `#2ca7db`.
- `before/before-picker-*.png` against `after/after-picker-*.png`: the old
  eight swatches (blue, violet, emerald, rose, amber, cyan, fuchsia, lime) and
  the new eight (blue, cyan, fuchsia, lime, coral, apricot, jade, iris). The
  new set is paler, since every hue sits at L 0.78.
- `after/account-coral-after.png`, `after/account-iris-after.png`: the accent
  reaches the sidebar, the page heading and the buttons. The solid
  `--brand-blue-hover` fill carries a white label on `Update Info`; it reads,
  but its contrast is low (about 3:1). PR 3 moves button labels to
  `--cx-on-accent`.

## The eight hues (OKLCH, rendered hex)

| key | name (placeholder) | OKLCH | hex |
|---|---|---|---|
| blue | Ocean Blue (kept) | oklch(0.78 0.12 232) | #5cc5f7 |
| cyan | Cyan (kept) | oklch(0.78 0.12 200) | #3aced6 |
| pink | Fuchsia (kept) | oklch(0.78 0.12 325) | #de9ce2 |
| lime | Lime (kept) | oklch(0.78 0.12 131) | #9cc774 |
| coral | Coral (was rose) | oklch(0.78 0.12 355) | #f496bb |
| apricot | Apricot (was amber) | oklch(0.78 0.12 50) | #f5a06f |
| jade | Jade (was emerald) | oklch(0.78 0.12 175) | #52d0b3 |
| iris | Iris (was violet) | oklch(0.78 0.12 275) | #a1b1ff |

Contrast of each hue as text on the five dark surfaces: worst 4.61:1 (coral on
`--cx-surface-4`), best 8.78:1 (jade on `--cx-surface-0`). 40 of 40 pairs clear
4.5:1.
