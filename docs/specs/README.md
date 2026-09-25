# Specs

Forward-looking design documents: what we intend to build and why.

This is the counterpart to [`docs/maps/`](../maps/README.md), which describes how
the system works **today**. Keep the two honest about their tenses. A map that
describes something unbuilt is a lie; a spec that describes something already
shipped is dead weight and should be deleted once its work lands and the maps
are updated to cover it.

| Document | What it is |
|---|---|
| [roadmap.md](roadmap.md) | The tracks the project is decomposed into, the evidence behind each, and the order to do them in. Start here. |
| [2026-09-24-suite-identity.md](2026-09-24-suite-identity.md) | Wave 6: Cloud Codex as a generic OIDC relying party, with hashed per-sign-in sessions and sign-out that propagates. Also the shared live-MySQL test project, W6-CDX-10. |
| [2026-09-24-outbound-events.md](2026-09-24-outbound-events.md) | Wave 6: a general outbound webhook subsystem, off by default, and the `codex.event.v1` contract. |
| [2026-09-24-suite-ui.md](2026-09-24-suite-ui.md) | Wave 6: the shared Apache-2.0 tokens vendored in, the palette and accent picker on them, and the suite shell in suite mode. |
| [2026-09-24-suite-hosting-readiness.md](2026-09-24-suite-hosting-readiness.md) | Wave 6: stop handling, health, a single-writer lock, production configuration, per-instance grants, authorized document images, backups, and the release the test box pins. |

Track A and track S (C2-0 to C2-5) both shipped, and their specs and plans were
deleted per the convention below; see [roadmap.md](roadmap.md) for what shipped
and the maps for how it works now.

## Conventions

- One spec per sub-project, named `YYYY-MM-DD-<topic>.md` by the date it was
  agreed.
- A spec states what is **in** scope, what is **explicitly deferred** and why,
  and what "done" means concretely enough to test.
- Cite `file:line` for any claim about current behaviour, the same way the maps
  do, so a reader can check rather than trust.
- When a spec's work ships: update the affected maps in the same PR, then delete
  the spec. The maps become the record.
