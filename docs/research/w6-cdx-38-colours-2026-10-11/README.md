# W6-CDX-38: neutrals, base and the hover model (dark theme)

Captured 2026-10-11 against a throwaway Codex (`NODE_ENV=development`, seeded with `seed.sql`, MySQL 8.4 in a
container on a private network, the app published on 127.0.0.1 only). Headless Chrome over CDP; `raw/capture-script.mjs`
produced every PNG, and every PNG was opened and read after capture. The first-run welcome was dismissed on the
server before the captures, so it does not cover the pages.

- `before/`: the code at `2922be9` (the spec commit, before any W6-CDX-38 change).
- `after/`: this branch's dark theme, the same routes, the same seeded data.
- Surfaces: home, an archive, a document (read-only), Account and Admin, at 1280x860 and 390x844.

What changed on screen: the page and the sunken well each step darker, the panel and card surfaces move to the
suite pattern's values, card hairlines and the controls' stronger hairline are both visible, the selects paint dark
native chrome, buttons and inputs take the page typeface, and the danger button is a bright fill with the dark ink.
The archive's Delete buttons are the danger button; their computed label is `oklch(0.14 0.03 240)` on
`oklch(0.63 0.19 25)`.

`raw/geometry-before.json` and `raw/geometry-after.json` are a geometry probe of the document page (the content
column, the header, the archive view and every control's box) at both widths. The only movement is the typeface
change: the top-bar search field is 1px taller (31 to 32px), and the buttons and the page-tree labels move by 1 to 2px
in width. No container moved.

Not verified here: the two-cursor smoke with a comment (it needs two signed-in browsers and a comment on the
document), and the light theme (W6-CDX-43).
