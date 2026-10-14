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
| [2026-10-14-standalone-codex.md](2026-10-14-standalone-codex.md) | The standalone track (CDX-SA): Codex becomes a standalone product, the suite integration is removed, and 0.15.0 and 1.0.0 follow, with the pre-1.0 standalone review. |

Track A and track S (C2-0 to C2-5) both shipped, and their specs and plans were
deleted per the convention below; see [roadmap.md](roadmap.md) for what shipped
and the maps for how it works now.

The Wave 6 outbound-events and hosting-readiness tracks shipped with 0.14.0 (W6-CDX-36), and their specs and plans
were deleted in that release. The identity spec and plan stay until the standalone track's PR 4 retires them (their last open item, a live sign-in against the suite's issuer, is replaced by the standalone review's sign-in through a non-default provider).

## Conventions

- One spec per sub-project, named `YYYY-MM-DD-<topic>.md` by the date it was
  agreed.
- A spec states what is **in** scope, what is **explicitly deferred** and why,
  and what "done" means concretely enough to test.
- Cite `file:line` for any claim about current behaviour, the same way the maps
  do, so a reader can check rather than trust.
- When a spec's work ships: update the affected maps in the same PR, then delete
  the spec. The maps become the record.
