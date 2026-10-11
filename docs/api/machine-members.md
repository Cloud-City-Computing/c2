# API Reference: Machine Membership Sync

These two routes let a paired product (Cloud Command) admit, re-role and remove members of this instance. They are machine-only: `requireMachine` answers a logged-in session with the same `401` an anonymous caller gets, whatever its role. The credential is the machine credential (`Authorization: Bearer <SERVICE_TOKEN>`, or a machine JWT when `OIDC_ISSUER_URL`, `MACHINE_OIDC_AUDIENCE` and `MACHINE_OIDC_SUBJECTS` are set; see [security.md](../security.md)). The principal acts as `SERVICE_TOKEN_USER`.

These are the only machine routes that write, and the only ones that can grant instance admin.

## Rate limit

Both routes share one bucket of **300 requests per minute, per IP**, separate from the auth bucket. A `429` is retryable: the caller waits and retries, honouring `Retry-After` when present. It is never a permanent failure.

## `PUT /api/machine/members`

Admit a member, or change their role. Idempotent: the same request twice leaves the same state.

Body: `{ "email": "person@example.com", "role": "admin" | "member", "issuer": "...", "subject": "...", "reactivate": true }`.

- `issuer` and `subject` are the person's identity at the instance's issuer. **Cloud Command sends them whenever it has them.** They go together: an issuer without its subject, or the reverse, is a `400`.
- `reactivate` is optional and defaults to `false`. **Cloud Command sends `reactivate: true` only on an explicit admin add or re-add, never on a re-role, a retry, or any other automatic sync.** A stale retry must not undo a removal.

| Status | When |
|---|---|
| `200` | `{ "success": true }`. |
| `400` | The email is missing or invalid, or the role is not `admin` or `member`. |
| `401` | No machine credential, or a session token. |
| `409` | See the refusals below. The body carries `reason` and a message. |
| `429` | The machine bucket is spent. Retry. |
| `503` | `no_boot_admin`: the instance has no boot admin row (see the boot log). Nothing is written until one exists. |

What it does, by what the address resolves to:

- **No account holds the address, and the invitation was removed.** Refused as `409 account_deactivated`, and the invitation is left as it is. Only `reactivate: true` re-admits it. A stale admission sent before a removal therefore cannot undo the removal.
- **No account holds the address.** An open invitation is created, or refreshed, for it. It grants instance admin when `role` is `admin` (`user_invitations.grants_admin`). It names the instance's seeded `General` squad with write access, so the person lands there on their first sign-in. If an admin has renamed or deleted `General`, the invitation names no squad, and an instance admin places the person. An invitation that already names a squad keeps it. No email is sent.
- **An account holds the address (or the subject's identity).** Its `is_admin` is set to match `role`. A `member` role clears admin, which is how an ownership transfer moves the admin flag. The account is also placed in the instance's `General` squad with read and write, if it is not a member there already (D-S). A second request changes nothing.

**When a subject is sent, it is the only match.** The account its identity row links to is the one changed, whatever address is sent. The address is used only when no identity exists yet, and then only for an account that holds no different identity at this issuer. Otherwise the answer is `409 identity_conflict` and nothing is written.

### Refusals (`409`)

| `reason` | When |
|---|---|
| `managed_by_configuration` | The address is `ADMIN_EMAIL`, or resolves to the boot admin's account. The boot admin is owned by the server configuration. |
| `machine_account` | The address resolves to the machine principal's own account. |
| `account_deactivated` | The account was removed and `reactivate` is not `true`. Re-admission is explicit. |
| `ambiguous_address` | The address matches more than one account. Nothing is guessed; a person resolves it. |
| `identity_conflict` | With a subject: the address belongs to an account that already holds a different identity, at this issuer or another. It is not moved, and the answer is never a `200` without the link. |

A refusal writes nothing.

## `DELETE /api/machine/members/:email` and `DELETE /api/machine/members`

Remove a member from this instance. Idempotent: removing an already-removed member answers the same `200`, and the first removal time is kept.

- `DELETE /api/machine/members?issuer=...&subject=...` removes by subject alone, the form Cloud Command uses whenever it has the subject. The address is optional in the query as `email`.
- `DELETE /api/machine/members/:email` removes by address. Pass `issuer` and `subject` in the query as well when they are known; then the subject is the only match, as on `PUT`.
- Neither a subject nor an address is a `400`.

Effects, in one transaction: any open invitation for the address expires, and the account (if any) is deactivated and loses instance admin. Its sessions are deleted, and its open sockets close at once. Sign-in is refused afterwards as `account_deactivated`. Authorship is kept: documents the person wrote keep their author.

| Status | When |
|---|---|
| `200` | `{ "success": true }`. An unknown address also answers `200`. |
| `400` | The address is not valid. |
| `401` | As for `PUT`. |
| `409` | `managed_by_configuration`, `machine_account`, `ambiguous_address` or `identity_conflict`, as above. |
| `429` | As for `PUT`. |

## How an address is matched

With a subject, the identity is the match and the address is not consulted for it. Without one, an address resolves to an account through the account's own email, and through the address its identity last signed in with (the issuer's current address, which Cloud Command follows). Every comparison is binary, so an accented address never matches its unaccented twin. Sign-in itself keys on `(issuer, subject)`, never on an address.

## Deferred: retirement

The identity spec and plan are retired in the last step of W6-CDX-36, not in this PR. Other tracks still link to them.
