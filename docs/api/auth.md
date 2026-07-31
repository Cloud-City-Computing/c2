```
─── ◆ ─────────────────────────────────────────────────────────────────────
   API · Authentication & Accounts
─── ◆ ─────────────────────────────────────────────────────────────────────
```

# API Reference — Authentication & Accounts

All auth endpoints are mounted under `/api`. Rate limiting applies on sensitive routes (20 requests per 15-minute window per IP).

Authentication is carried as a **Bearer token** in the `Authorization` header for API calls, or a `sessionToken` cookie for browser redirects (e.g. OAuth callbacks). The token is a 64-character random string returned on login.

---

## Public Endpoints

These endpoints do not require a session token.

---

### `POST /api/create-account`

Create a new user account. Requires a valid invitation token — Cloud Codex does not allow open registration.

**Body**

```json
{
  "username": "alice",
  "password": "Str0ng!Pass",
  "email": "alice@example.com",
  "inviteToken": "<token from invitation email>"
}
```

**Password rules:** Min 8 characters, must include uppercase, lowercase, digit, and special character.

**Responses**

| Status | Meaning |
|--------|---------|
| `201`  | Account created. Returns `{ token, user: { id, name } }` |
| `400`  | Missing fields, invalid username/email/password, or bad/expired invitation token |
| `409`  | Username or email already taken |

On success a session is automatically created and the token is returned.

---

### `GET /api/check-username/:username`

Check whether a username is available (before submitting the full sign-up form).

**Response:** `{ available: boolean, message: string }`

---

### `POST /api/login`

Authenticate with username and password.

**Body:** `{ username, password }`

**Responses**

| Status | Meaning |
|--------|---------|
| `200`  | `{ success: true, token, user }` — login complete |
| `200`  | `{ success: true, requires_2fa: true, method: 'email'\|'totp', twoFactorToken }` — 2FA step required |
| `401`  | Invalid credentials (message is intentionally vague) |
| `503`  | `{ success: false, message }` — the account uses **email** 2FA and mail is disabled on this instance |

When 2FA is required, pass the returned `twoFactorToken` to the appropriate `/api/2fa/*` endpoint.

The `503` case is a deliberate refusal, not a fallback: no `twoFactorToken` is
issued and no code row is written, because a challenge whose code cannot be
delivered is a lockout dressed up as a prompt. The password check still runs
first, so this reveals nothing to a caller without valid credentials, and it
grants nothing — the account stays locked until an administrator restores mail.
TOTP accounts are unaffected and log in normally.

---

### `POST /api/forgot-password`

Request a password reset link. Sends an email to the account address if it exists.

**Body:** `{ email }`

Always returns `200` (success: true) regardless of whether the email matched, to prevent user enumeration.

---

### `POST /api/reset-password`

Consume a reset token and set a new password.

**Body:** `{ token, password }`

**Responses:** `200` on success, `400` for invalid/used/expired token or bad password.

---

### `GET /api/invite/validate/:token`

Validate an invitation token before showing the sign-up form.

**Response:** `{ valid: boolean, email }` — returns the target email so the form can pre-fill it.

---

## Two-Factor Authentication

---

### `POST /api/2fa/verify`

Verify an email 2FA code during login.

**Body:** `{ twoFactorToken, code }`

**Response:** `{ success: true, token, user }` — issues a full session on success.

---

### `POST /api/2fa/totp/verify`

Verify a TOTP code during login.

**Body:** `{ twoFactorToken, code }`

**Response:** `{ success: true, token, user }`

---

### `POST /api/2fa/enable` *(requires auth)*

Enable two-factor authentication for the current user.

**Body:** `{ method: 'email' | 'totp' }`

- `method: 'email'` — enables email-based 2FA immediately.
  **Response:** `{ success: true, message }`.
  If mail is disabled on this instance, returns `400 { success: false, message }`
  instead (email 2FA would be a lockout with no inbox to receive the login code).
- `method: 'totp'` — generates a TOTP secret and QR code, stores the secret
  pending confirmation, and creates a setup token. The user must then call
  `POST /api/2fa/totp/confirm` with that token and a code from their app.
  - If mail is enabled, the QR code is emailed to the user's address.
    **Response:** `{ success: true, message, setupToken }`.
  - If mail is disabled, the setup material is returned inline instead of
    emailed. **Response:** `{ success: true, message, setupToken, qr_data_url, secret }`,
    where `qr_data_url` is the QR code as a base64 PNG data URL and `secret` is
    the base32 TOTP secret for manual entry.

---

### `POST /api/2fa/totp/confirm` *(requires auth)*

Confirm a TOTP code to complete TOTP setup. Activates TOTP 2FA on the account.

**Body:** `{ code }`

---

### `POST /api/2fa/disable` *(requires auth)*

Begin disabling two-factor authentication. Emails a 6-digit verification code
and returns a `confirmToken`; the caller completes the change with
`POST /api/2fa/disable/confirm`. This is a two-step flow for **both** methods:
the confirmation code travels by email whether the account uses email 2FA or
TOTP.

**Body:** none

**Responses**

| Status | Meaning |
|--------|---------|
| `200`  | `{ success: true, confirmToken, message }` — code sent, confirm next |
| `200`  | `{ success: true, message }` (no `confirmToken`) — 2FA was already off, nothing to do |
| `401`  | Not authenticated |
| `503`  | `{ success: false, message }` — mail is disabled on this instance |

The `503` applies to email and TOTP accounts alike, since neither can receive
the confirmation code. Nothing is minted on that path: no `confirmToken` and no
code row, so the API never claims a code was sent when none was. With no
admin-side 2FA reset endpoint, restoring mail is the only route back (see
`docs/maps/open-questions.md`, item B8).

---

### `POST /api/2fa/disable/confirm` *(requires auth)*

Complete the disable started by `POST /api/2fa/disable`. Validates the
`confirmToken` and the emailed code, then sets `two_factor_method = 'none'` and
clears any stored TOTP secret.

**Body:** `{ confirmToken, code }`

**Responses**

| Status | Meaning |
|--------|---------|
| `200`  | `{ success: true, message }` — 2FA disabled |
| `400`  | `confirmToken` or `code` missing |
| `401`  | Token expired, already used, belongs to another user, or the code is invalid/expired |

---

## Authenticated Account Endpoints

---

### `GET /api/me`

Returns the current user's profile.

**Response:** `{ user: { id, name, email, avatar_url, is_admin, two_factor_method } }`

---

### `POST /api/update-account`

Update the current user's username, email, and/or password.

**Body:** `{ token, userId, name?, email?, password? }`

All fields are optional — only provided fields are updated. If password is changed, all other sessions for the user are invalidated.

---

### `POST /api/logout`

Invalidate the current session.

---

### `POST /api/setup`

Quick-start helper for new users. Creates a standalone personal archive (not attached to any workspace/squad).

**Body:** `{ archiveName }`

**Response:** `{ success: true, archiveId }`

---

## User Search

### `GET /api/users/search?q=<query>`

Search for users by username (for invite dialogs). Rate-limited to 60 requests per 15 minutes per IP to prevent user enumeration.

**Response:** `{ users: [{ id, name, email, avatar_url }] }`
