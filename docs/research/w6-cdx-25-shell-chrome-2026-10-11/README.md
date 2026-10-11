# W6-CDX-25: the suite cluster in the top bar, dark theme

Captured 2026-10-11 against a throwaway Codex (`NODE_ENV=development`, MySQL 8 in a container,
suite mode on with `SUITE_NAME` "Example Suite" and a placeholder Cloud Command URL), signed in as
the admin. The browser was headless, and the page was read after each capture.

- `suite-open-1280.png`: the disclosure open at 1280 wide. The panel lists Cloud Codex (current,
  ticked, blue), Cloud Command, a separator, and All workspaces, over the sidebar and the content,
  not clipped by the top bar.
- `suite-open-390.png`: the same at 390 wide. The panel sits whole under the toggle, above the
  mobile bottom navigation's content.
- `raw/capture-output.txt`: the scripted read-back. The toggle's accessible name, the link order,
  `aria-current`, Escape closing the panel and returning focus to the toggle, and the panel's
  bounds at 390 wide.
- `raw/capture-script.mjs`: the script that produced them (a headless shell over the DevTools
  protocol, with the session cookie set from a real login).

Not captured here: Cloud Command's sidebar beside it (that needs Command's stack running), and a
suite-off render (the suite-off top bar is held by the DOM snapshot in
`tests/src/page_layouts/top-bar.test.jsx`, taken from the pre-change code).
