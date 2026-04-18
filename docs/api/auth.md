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
| `200`  | `{ requires_2fa: true, twoFactorMethod: 'email'\|'totp', twoFactorToken }` — 2FA step required |
| `401`  | Invalid credentials (message is intentionally vague) |

When 2FA is required, pass the returned `twoFactorToken` to the appropriate `/api/2fa/*` endpoint.

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

### `POST /api/2fa/setup/email` *(requires auth)*

Enable email-based 2FA for the current user. Sends a verification code.

---

### `POST /api/2fa/setup/totp` *(requires auth)*

Begin TOTP setup. Returns `{ secret, qrCode }` (base64 PNG QR code).

---

### `POST /api/2fa/totp/confirm` *(requires auth)*

Confirm a TOTP code to complete TOTP setup. Activates TOTP 2FA on the account.

**Body:** `{ code }`

---

### `POST /api/2fa/disable/confirm` *(requires auth)*

Disable 2FA. Requires current password for confirmation.

**Body:** `{ password }`

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
