# W6-CDX-25: the suite cluster in the top bar, dark theme

Captured 2026-10-11 against a throwaway Codex (`NODE_ENV=development`, MySQL 8 in a container,
suite mode on, the admin signed in). The browser was headless, and every PNG was read after capture.
Raw output and the scripts that produced it are in `raw/`.

First pass (open disclosure, 1280 and 390 wide, "Example Suite"):
- `suite-open-1280.png`: the disclosure open, unclipped over the sidebar and content.
- `suite-open-390.png`: the same at 390 wide.

Review pass (the coordinator's three findings, plus the footer regression they exposed):
- `bell-open-390x844.png`: the notification dropdown open with twelve unread notifications at
  390x844. Its footer and "View all" sit above the mobile bottom nav, which the dropdown covers.
  `topmost` at the nav band is the dropdown, not the nav.
- `cluster-long-name-390x844.png`: a 40-character suite name ("Northwind Partners Shared Workspace
  Suit", the last character is the 40th) at 390 wide. The eyebrow ends in an ellipsis; the bell and
  account controls stay inside the viewport (`.topbar__right` at x 284 to 364 of 390).
- `document-390x844.png`: a document page at 390 wide. Headings are Poppins (the plan's decision
  9 face for headings), body text is Inter. The mobile nav's icon row is topmost over the footer row.
- `sidebar-hover-over-highlight-1280.png`: the collapsed sidebar hover-expanded at 1280 wide over a
  red editor overlay. The overlay is a stand-in for a real comment highlight: the page injects a
  `comment-highlights` element with the real class (its stylesheet z-index is what is measured), and
  the sidebar covers it. Stated plainly because a real highlight needs a comment on the document.

Not captured: Cloud Command's sidebar beside the cluster (needs Command's stack), and a suite-off render
(the DOM snapshot in `tests/src/page_layouts/top-bar.test.jsx` holds it).
