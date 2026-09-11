# Spec: a workspace reader check for the suite (C2-5)

- **Status:** approved
- **Date:** 2026-09-11
- **Track:** C2-5
- **Requested by:** Kyle, for Cloud Command's `S5.1b-f`

## The problem this exists to close

Cloud Command stores a `c2_workspace_id` on its own workspace row, and uses it to narrow the
document picker's search to one Cloud Codex workspace. **Today that integer is caller-asserted.**
Cloud Command's admin types a number and nothing checks that they have any business reading that
workspace.

The consequence is an enumeration: any account that can create a Cloud Command workspace can set
`c2_workspace_id` to any integer and read document titles out of a Cloud Codex workspace it has no
account for. The service token is a single shared credential with read access across the install, so
the picker happily answers.

**Cloud Command cannot fix this alone.** It can only ask. The answer has to come from the system that
owns the access-control rules, which is this one.

## What this track ships

**One endpoint**, which answers a single question:

> May the person with this email address read this workspace?

```
GET /api/workspaces/:workspaceId/reader-check?email=<address>
→ 200 { "canRead": true | false }
```

## The decisions that shape it

### It is MACHINE-ONLY, not `machineOrAuth`

The two existing service-token routes (`/search`, the archive browse) use `machineOrAuth`, which
falls back to an ordinary session. **This one must not.** It is an oracle: it answers questions about
*other people's* access. A logged-in Cloud Codex user who could reach it could enumerate which
colleagues belong to which workspaces, and — because a non-existent email answers `false` the same
way an unauthorised one does — probe which addresses have accounts here.

Behind the machine credential the exposure is bounded to a compromised Cloud Command server, which is
a system we operate. Behind a session it would be every user.

So this track adds `requireMachine`, a sibling of `machineOrAuth` that refuses a session outright.

### It identifies the person by EMAIL, because that is the only shared name

Cloud Command and Cloud Codex have separate `users` tables. The long-term direction is a shared
Cloud City ID service, and it does not exist. Email is the one identifier both systems already hold
and already treat as unique (`users.email` is `UNIQUE` here; Cloud Command has
`uq_users_email_lower`).

**Matched case-insensitively.** MySQL's default collation is case-insensitive, so `=` already does
this — but the comparison is written `LOWER(email) = LOWER(?)` so the intent survives a future
collation change rather than depending on one.

### "Can read a workspace" means owner, squad member, or admin

Derived from the rules this product already has, rather than invented:

1. **Admin** — reads every archive in the install, so every workspace.
2. **Workspace owner** — `workspaces.owner_id`, the top of the cascade in
   `routes/helpers/ownership.js`.
3. **A member of any squad in that workspace** — which is exactly what that file's
   `read_access_workspace` clause already means by "user is in any squad of the same workspace".

**What it deliberately is NOT** is "has read access to at least one archive in the workspace". That
is a narrower question and the wrong one: the picker searches a workspace, and a person who belongs
to a workspace but happens to have no archive grants yet should still be allowed to connect it. The
per-archive grants still apply to every search that follows — this check gates the MAPPING, not the
reads.

### A missing user and an unauthorised user answer identically

`{ "canRead": false }` in both cases, with no distinction in the body or the status. Distinguishing
them would turn the endpoint into an account-existence oracle for whoever holds the service token.

### It is rate-limited

An oracle answering a boolean invites enumeration even behind a credential. It gets the same
`authLimiter` the login surface uses.

## What this track does NOT ship

- **No change to any existing access rule.** No new grant, no new column, no migration.
- **No caching.** The answer is a live read; a stale "yes" is a stale authorisation.
- **No write.** It records nothing and logs no activity, exactly as the two existing service-token
  routes do not.
- **No Cloud Command code.** The consuming half is `S5.1b-f` in that repo, under its own protocol
  and its own PR. This track ends at the endpoint.

## How the suite uses it

Cloud Command's `S5.1b-f` calls this at PATCH time, with the acting admin's own email, and refuses to
write `workspaces.c2_workspace_id` when the answer is `false`.

**The gate Cloud Command wrote against itself is phrased against the CONTROL, not a session id:** no
session there ships anything that writes `c2_workspace_id` until this endpoint exists and `S5.1b-f`
consumes it. This track satisfies the first half.

## Acceptance

- A machine caller asking about a workspace owner gets `true`.
- A machine caller asking about a squad member of that workspace gets `true`.
- A machine caller asking about an unrelated user gets `false`.
- A machine caller asking about an unknown email gets `false`, indistinguishably.
- A machine caller asking about an admin gets `true`.
- **A SESSION caller is refused**, whatever their role.
- An unauthenticated caller is refused.
- A missing or malformed `email` is a 400.
- A non-numeric `:workspaceId` is a 400, and a workspace that does not exist answers `false` rather
  than 404 — the absence of a workspace is not a fact this endpoint should disclose either.
