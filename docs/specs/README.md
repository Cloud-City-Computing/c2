# Specs

Forward-looking design documents: what we intend to build and why.

This is the counterpart to [`docs/maps/`](../maps/README.md), which describes how
the system works **today**. Keep the two honest about their tenses. A map that
describes something unbuilt is a lie; a spec that describes something already
shipped is dead weight and should be deleted once its work lands and the maps
are updated to cover it.

| Document | What it is |
|---|---|
| [roadmap.md](roadmap.md) | The five tracks the project is decomposed into, the evidence behind each, and the order to do them in. Start here. |
| [2026-07-27-five-minute-evaluation.md](2026-07-27-five-minute-evaluation.md) | Track A, the first sub-project: make Cloud Codex runnable and demo-able by a stranger in five minutes. |

## Conventions

- One spec per sub-project, named `YYYY-MM-DD-<topic>.md` by the date it was
  agreed.
- A spec states what is **in** scope, what is **explicitly deferred** and why,
  and what "done" means concretely enough to test.
- Cite `file:line` for any claim about current behaviour, the same way the maps
  do, so a reader can check rather than trust.
- When a spec's work ships: update the affected maps in the same PR, then delete
  the spec. The maps become the record.
