# W6-CDX-15: the webhooks panel, looked at

Captured 2026-10-11 against a local app (non-production, one admin, three admin subscriptions)
with real worker traffic: `http://127.0.0.1:8099/ok` answered 200, `/reject` answered 401 (so it
stalled), and `/off` was turned off in the admin API.

- `after/cdx15-webhooks-desktop.png` (1280 wide): Delivering, Stalled (with the 401 explanation,
  the next try and the deliveries expanded, with a Redeliver on the dead row), and Off.
- `after/cdx15-webhooks-phone-bottom.png` (390 wide, scrolled to the bottom): the sidebar is a row
  above the content, the last card clears the fixed bottom nav, and the deliveries table keeps the
  event, status and last answer. The Redeliver button sits at the table's right edge and is reached
  by scrolling the table sideways; it is not fully on screen at this width.

Both were taken with a headless Chrome driven over the DevTools protocol, logged in as the
instance admin, after the stalled card's deliveries were expanded. The script is not kept here
because it carries a local test login.
