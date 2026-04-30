```
─── ◆ ─────────────────────────────────────────────────────────────────────
   SECURITY · Vulnerability Disclosure Policy
─── ◆ ─────────────────────────────────────────────────────────────────────
```

# Security Policy

Cloud Codex is a self-hosted documentation platform with authentication,
real-time collaboration, and OAuth integrations. We take vulnerability
reports seriously and aim to make disclosure straightforward for
researchers and operators.

---

## Reporting a vulnerability

```
   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
   ┃                                                                   ┃
   ┃   Email:   security@cloudcitycomputing.com                         ┃
   ┃   Subject: [Cloud Codex Security] <short summary>                  ┃
   ┃                                                                   ┃
   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

**Please do not open a public GitHub issue or PR** for an unfixed
vulnerability. Use the email address above. We acknowledge receipt
within **72 hours** and aim for an initial impact assessment within
**5 business days**.

When reporting, please include:

- A description of the issue and the affected version/commit
- A proof-of-concept or steps to reproduce
- The impact you believe it has (data exposure, privilege escalation,
  denial of service, etc.)
- Whether the issue is exploitable in a default Cloud Codex install or
  requires specific configuration
- Your name and a link / handle for credit, if you'd like attribution

If your report concerns a third-party dependency rather than Cloud Codex
code itself, please tell us anyway — we may need to upgrade or patch on
our side.

---

## What's in scope

The Cloud Codex application code in this repository, including:

- The Node application under `cloudcodex/` (routes, services,
  middleware, frontend)
- The SQL schema and migrations
- The Docker Compose deployment files

Specifically scoped vulnerabilities we want to hear about:

- Authentication bypass, session fixation/hijacking
- Authorization bypass against the layered access control
- SQL injection, XSS (stored or reflected), CSRF, SSRF, RCE
- Insecure direct object references on routes that should be
  permission-gated
- Cryptographic weaknesses around session tokens, password storage,
  OAuth-token-at-rest encryption
- WebSocket auth or origin-check bypasses on `/collab` or
  `/notifications-ws`
- Email header injection (`services/email.js`)
- Sandbox/sanitization escapes in DOMPurify usage

Outside of scope (please don't report):

- Findings against a deployment you don't operate (no third-party
  Cloud Codex instances are managed by us)
- Missing security headers on third-party CDN-hosted assets
- Self-XSS that requires the victim to paste payloads into their own
  console
- Vulnerabilities in third-party services (Google, GitHub) that are
  not specific to Cloud Codex's integration

---

## Coordinated disclosure

We'll work with you on a coordinated timeline:

- We confirm the issue, assess impact, and develop a fix.
- We coordinate a release and a public advisory.
- We credit you in the release notes and the advisory unless you'd
  rather stay anonymous.

We aim to ship fixes for high-severity issues within **30 days** of
confirmation. For very high impact issues we'll often move faster; for
lower-severity hardening we may bundle the fix into the next regular
release.

Please give us a reasonable disclosure window before publishing. If
30 days isn't going to work for the severity of the issue, tell us
upfront and we'll discuss.

---

## Supported versions

Cloud Codex is shipped from the `main` branch of this repository. We
support security fixes against:

| Version          | Supported              |
|------------------|------------------------|
| `main`           | yes — latest commit    |
| Tagged releases  | the most recent tag    |
| Older tags       | best-effort, no SLA    |

If you're running an older deployment, the most reliable mitigation is
to upgrade. The migration path is additive — see
[`docs/deployment.md`](./docs/deployment.md).

---

## Source-available license note

Cloud Codex is released under a source-available license. That license
governs use, modification, and redistribution of the code. **It does
not change responsible-disclosure expectations** — please continue to
report issues privately first regardless of how you obtained the code.
