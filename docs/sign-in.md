# Sign-in

Codex signs people in one of three ways, and an instance can offer any combination: local accounts
(password, two-factor, email reset), Google, and one OIDC issuer. `AUTH_PROVIDERS` chooses which are
on. Unset, the instance offers local accounts, plus Google when its two variables are set and OIDC when
an issuer is set.

## Local accounts

The default. Accounts have a password, may turn on two-factor, and reset their password by email when
SMTP is configured. The boot admin is created from `ADMIN_USERNAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`
(see [deployment.md](./deployment.md#the-boot-admin)).

## Google

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. `GOOGLE_OAUTH_DOMAIN` restricts sign-in to one
Google Workspace domain. Google sign-in requires a verified email, and an account that already has
two-factor on is refused rather than linked by email.

## OIDC

Codex is an OIDC relying party: it runs the authorization code flow with PKCE, verifies the ID token,
and reads identity claims from the ID token, with the userinfo endpoint overriding the fields it returns. It works with any standard OIDC issuer.

### Configure the instance

| Variable | Meaning |
|---|---|
| `OIDC_ISSUER_URL` | The issuer's base URL, the value of its discovery document's `issuer`. Setting it turns OIDC on. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | This instance's application at the issuer. Both are required with the issuer URL. |
| `OIDC_PROVIDER_NAME` | The label on the button: "Sign in with *name*". Default `SSO`. |
| `OIDC_LINK_BY_VERIFIED_EMAIL` | `1` (default) links an existing account to the issuer identity by its verified email, when that account has two-factor off. `0` never links by email. |
| `OIDC_SESSION_TTL_HOURS` | How long an OIDC sign-in lasts, in whole hours. Default `24`. |
| `APP_URL` | Required. The public address people use; the redirect and logout URIs below are built from it. |

The application at the issuer must register these three URIs, where `<APP_URL>` is the same value:

- Redirect (sign-in callback): `<APP_URL>/api/auth/oidc/callback`
- Post-logout redirect: `<APP_URL>/?signedOut=1`
- Back-channel logout (optional, see below): `<APP_URL>/api/auth/oidc/backchannel-logout`

Codex requests the scopes `openid email profile`. The issuer must return a **verified email**
(`email_verified` true). A sign-in without one is refused, because the email is the only thing that can
link an account.

### Identity

Codex keys each person on the pair (issuer, subject). An issuer identity links to an account in this
order: a row already linked to that identity; then, with `OIDC_LINK_BY_VERIFIED_EMAIL=1`, an account
with the same verified email and two-factor off; then an open invitation for that email, which creates
the account once. With no link and no invitation, the sign-in is refused as `no_account`. An issuer's
own self-registration never admits anyone.

Two refusals need an operator:

- `identity_conflict`: the account is already linked to a different subject at this issuer. Unlink the
  old identity, or confirm the person is the same and relink the account by hand (see
  [deployment.md](./deployment.md#oidc-only-mode)).
- `two_factor_enabled`: an account with two-factor on is not linked by email, since an email link would
  let it skip the second factor. Turn two-factor off for that account, or have an administrator reset its
  2FA, and the next OIDC sign-in links it.

### OIDC-only mode

Set `AUTH_PROVIDERS=oidc`, with the issuer variables and no Google variables. Then the issuer is the only
way to sign in. Local sign-in routes answer 404 on the server, and any local session is ended at boot.
An administrator's two-factor reset (`POST /api/admin/users/:id/2fa/reset`) still works in this mode, so
local two-factor can be cleared before switching back to local accounts. The full rules are in
[deployment.md](./deployment.md#oidc-only-mode).

### Two doors

With local sign-in on, an account linked to an issuer may use every door it has: its password, its
reset, its two-factor setup, and the issuer. OIDC-only mode makes the issuer the only door. The full
statement is in [security.md](./security.md#doors-into-an-account).

### One issuer per instance

An instance talks to one issuer. To accept people from two issuers, run two instances. This limit is
deliberate for 1.0.

## Provider notes

Each section says what was checked. Nothing here was tested live against a running Codex instance; the
notes come from the providers' public documentation, read as search results and not in full, and any
claim the sources did not settle is marked as unverified.

### Keycloak

- Issuer: `https://<host>/realms/<realm>`.
- Client: create an OpenID Connect client with client authentication on, and set the three URIs above.
- Back-channel logout: a public guide describes a "Backchannel Logout URL" setting on the client, with
  "Backchannel Logout Session Required" alongside it. The field's location varies by Keycloak version
  and was not confirmed for the version you run.
- `email_verified`: not checked. Confirm the email mapper sends the verified flag before relying on it.
- Live test: not done.

### Authentik

- Issuer: the application's issuer URL under `https://<host>/application/o/<slug>/`.
- Back-channel logout: the provider's documentation describes a "Back-channel Logout URI" field on an
  OAuth2 provider, with the logout method set to back-channel. The documentation notes that the
  application must support OIDC Back-Channel Logout 1.0, and that it must accept form-encoded POST.
- `email_verified`: not checked.
- Live test: not done.

### Okta

- The search for Okta's own documentation returned no usable page. The issuer, redirect and sign-out
  settings, back-channel logout support, and whether `email_verified` is sent were **not verified**. Check
  Okta's current developer documentation for an "OIDC web app" before configuring.
- Live test: not done.

### Microsoft Entra ID

- Issuer: `https://login.microsoftonline.com/<tenant-id>/v2.0`.
- `email_verified`: **not verified**. Since CDX-SA-4 a sign-in reads the ID token's own `email_verified` when userinfo omits it, so this now depends only on the ID token. The sources found describe a different signal, the optional claim
  `xms_edov`, and say that the portal may not accept it directly. Whether a standard `email_verified` claim
  is sent in workforce-tenant ID tokens was not confirmed. Until it is, the verified-email requirement
  refuses sign-ins from a tenant that does not send it. The remedy is decided in PR 6 of the standalone plan.
- Back-channel logout: not verified.
- Live test: not done.
