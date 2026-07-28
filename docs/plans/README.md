# Plans

Task-decomposed implementation plans, one per approved spec in
[`../specs/`](../specs/README.md).

## Execution convention

**Plans in this repo are executed with `superpowers:subagent-driven-development`:**
one fresh subagent per task, with review between tasks. This is settled, not a
per-plan decision, and it should not be re-presented as a choice.

Delegating the writing does not delegate the verification. Review each task's
output, watch CI to green, and report honestly.

## Conventions

- Named `YYYY-MM-DD-<topic>.md`, matching the spec it implements.
- Every step carries the actual code, command, and expected result. A step that
  says what to do without showing how is a plan failure.
- Tasks are ordered so that a task which will break the suite for a known,
  explainable reason lands on its own commit.
- When a plan's work ships: update the affected maps, retire the spec, and
  delete the plan. The maps become the record.
