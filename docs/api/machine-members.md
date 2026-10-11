# API Reference: Machine Membership Sync

These two routes let a paired product (Cloud Command) admit, re-role and remove members of this instance. They are machine-only: `requireMachine` answers a logged-in session with the same `401` an anonymous caller gets, whatever its role. The credential is the machine credential (`Authorization: Bearer <SERVICE_TOKEN>`, or a machine JWT when `OIDC_ISSUER_URL`, `MACHINE_OIDC_AUDIENCE` and `MACHINE_OIDC_SUBJECTS` are set; see [security.md](../security.md)). The principal acts as `SERVICE_TOKEN_USER`.

These are the only machine routes that write, and the only ones that can grant instance admin.

## Rate limit

Both routes share one bucket of **300 requests per minute, per IP**, separate from the auth bucket. A `429` is retryable: the caller waits and retries, honouring `Retry-After` when present. It is never a permanent failure.

## `PUT /api/machine/members`

Admit a member, or change their role. Idempotent: the same request twice leaves the same state.

Body: `{ "email": "person@example.com", "role": "admin" | "member", "reactivate": true }`. `reactivate` is optional and defaults to `false`.

| Status | When |
|---|---|
| `200` | `{ "success": true }`. |
| `400` | The email is missing or invalid, or the role is not `admin` or `member`. |
| `401` | No machine credential, or a session token. |
| `409` | See the refusals below. The body carries `reason` and a message. |
| `429` | The machine bucket is spent. Retry. |

What it does, by what the address resolves to:

- **No account holds the address.** An open invitation is created, or refreshed, for it. It grants instance admin when `role` is `admin` (`user_invitations.grants_admin`). It names the instance's seeded `General` squad with write access, so the person lands there on their first sign-in. If an admin has renamed or deleted `General`, the invitation names no squad, and an instance admin places the person. An invitation that already names a squad keeps it. No email is sent.
- **An account holds the address.** Its `is_admin` is set to match `role`. Its squad memberships are left alone. A `member` role clears admin, which is how an ownership transfer moves the admin flag.

### Refusals (`409`)

| `reason` | When |
|---|---|
| `managed_by_configuration` | The address is `ADMIN_EMAIL`, or resolves to the boot admin's account. The boot admin is owned by the server configuration. |
| `machine_account` | The address resolves to the machine principal's own account. |
| `account_deactivated` | The account was removed and `reactivate` is not `true`. Re-admission is explicit. |
| `ambiguous_address` | The address matches more than one account. Nothing is guessed; a person resolves it. |

A refusal writes nothing.

## `DELETE /api/machine/members/:email`

Remove a member from this instance. Idempotent: removing an already-removed member answers the same `200`, and the first removal time is kept.

Effects, in one transaction: any open invitation for the address expires, and the account (if any) is deactivated and loses instance admin. Its sessions are deleted, and its open sockets close at once. Sign-in is refused afterwards as `account_deactivated`. Authorship is kept: documents the person wrote keep their author.

| Status | When |
|---|---|
| `200` | `{ "success": true }`. An unknown address also answers `200`. |
| `400` | The address is not valid. |
| `401` | As for `PUT`. |
| `409` | `managed_by_configuration`, `machine_account` or `ambiguous_address`, as above. |
| `429` | As for `PUT`. |

## How an address is matched

An address resolves to an account in two ways: the account's own email, and the address its identity last signed in with (the issuer's current address, which Cloud Command follows). Both comparisons are binary, so an accented address never matches its unaccented twin. Sign-in itself keys on `(issuer, subject)`, never on an address.
