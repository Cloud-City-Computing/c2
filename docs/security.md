```
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║   SECURITY                                                                 ║
║   Defense-in-depth: edge → middleware → SQL → at-rest encryption.          ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝
```

# Security

Cloud Codex follows security best practices across all layers of the stack.
The model is **defense-in-depth** — a request is checked at every level
between the network edge and the database, and stored secrets are encrypted
even if the DB is compromised.

```
   request
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  edge:    helmet (CSP, X-Frame, X-CT, Referrer-Policy)   │
   │           CORS allowlist (no localhost in prod)          │
   │           express-rate-limit (auth 20/15m, search 60/15m)│
   └──────────────────────────────────────────────────────────┘
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  parsing: JSON 2 MB cap                                  │
   │           multer file size cap (10 MB)                   │
   └──────────────────────────────────────────────────────────┘
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  auth:    requireAuth (Bearer token / sessionToken cookie)│
   │           validateAndAutoLogin → user object on req      │
   │           requireAdmin / requirePermission               │
   └──────────────────────────────────────────────────────────┘
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  input:   DOMPurify (sanitizeHtml on every user-supplied │
   │           HTML write — REST AND WebSocket paths)         │
   │           length caps + isValidId on path params         │
   └──────────────────────────────────────────────────────────┘
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  access:  ownership.js readAccessWhere/writeAccessWhere  │
   │           7-step cascade in a single SQL fragment        │
   └──────────────────────────────────────────────────────────┘
      │
      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  storage: parameterized SQL (mysql2 prepared statements) │
   │           bcrypt 12 rounds for passwords                 │
   │           AES-256-GCM (scrypt-derived) for OAuth tokens  │
   └──────────────────────────────────────────────────────────┘
      │
      ▼
                       MySQL 8
```

---

## SQL Injection Prevention

All database queries use parameterized prepared statements via `mysql2`. User-supplied values are never interpolated directly into query strings.

---

## Password Storage

Passwords are hashed with **bcrypt** at 12 salt rounds. Comparisons use constant-time equality to prevent timing attacks.

---

## Session Management

Session tokens are 64-character cryptographically random strings (Node.js `crypto.randomBytes`) with a 7-day expiry. Sessions are invalidated immediately on password change and on successful password reset. IP address and user-agent are recorded per session.

---

## HTML Sanitization

**DOMPurify** is applied at three points: on server writes, on WebSocket broadcast, and on client rendering. `data:` URIs are restricted to `<img>` tags to prevent script injection via data URIs.

---

## OAuth Token Encryption

GitHub access tokens are encrypted at rest using **AES-256-GCM** with a key derived from `GITHUB_CLIENT_SECRET` via scrypt. OAuth state tokens are single-use and expire after 10 minutes.

---

## Security Headers

**Helmet** middleware applies a strict Content Security Policy and standard security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.) on every response.

---

## Rate Limiting

**express-rate-limit** enforces per-endpoint limits:

| Scope | Limit |
| --- | --- |
| Auth endpoints | 20 requests / 15 min |
| Search | 60 requests / 15 min |
| WebSocket messages | 60 messages / second |

---

## WebSocket Hardening

- Origin validation on connection upgrade
- Authentication timeout (unauthenticated connections are closed after a short window)
- 5 MB message size limit
- Per-user connection caps to prevent resource exhaustion

---

## Content Size Limits

| Resource | Limit |
| --- | --- |
| Document content | 2 MB |
| Image uploads | 10 MB |

---

## CORS

Allowed origins are configured via the `CORS_ORIGIN` environment variable. The `localhost` bypass that is active in development is disabled in production builds.

---

## Input Validation

Length limits are enforced on all user-provided strings at the API boundary before any database interaction occurs.

---

## Email Header Injection Prevention

All fields used to construct outbound emails (name, subject, address) are sanitized before being passed to Nodemailer to prevent header injection attacks.
