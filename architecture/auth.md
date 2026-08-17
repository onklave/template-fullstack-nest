# Authentication and identity

## What is true today

**This API has no authentication of its own.** It relies on the Onklave gate in
front of the shared host: both services sit behind one forward-auth gate, so
the page load and the API call are authenticated by the same session before
either reaches this app.

That is correct *as long as both services stay behind one gate*. It stops being
correct the moment `api` is exposed on its own host, or the gate is set to
`public`. Either change requires real authentication in this service first.

Consequence you will see in the code: governed actions record
`actor: 'user:anonymous'` (`items.controller.ts`). It is honest — the app
genuinely does not know who the caller is.

## Adding authentication

Use `@onklave/app-runtime`'s auth lib rather than hand-rolling anything. The
platform provisions the app a dedicated end-user realm and a confidential OIDC
client, and delivers the config as per-environment secrets — the same injection
path as every other secret (`architecture/providers.md`):

```
ONKLAVE_OIDC_ISSUER_URL
ONKLAVE_OIDC_CLIENT_ID
ONKLAVE_OIDC_CLIENT_SECRET   ← server only, never served to the browser
```

- `getOidcConfig()` — resolved endpoints for the server, including the secret.
- `publicOidcConfig()` — the browser-safe subset. Serve **this** to the SPA,
  from a controller like `onklave-config.controller.ts`. Never the secret.
- `verifyAccessToken(token, { audience })` — validates a bearer token against
  the realm's JWKS (RS256, cached). Use it in a Nest guard.

The SPA runs a standard authorization-code + PKCE flow against the issuer.
Credential entry, MFA and passkeys happen on the realm's hosted login page:
**this app never handles a password**, and must never grow a form that does.

Then:

1. Add a guard that verifies the bearer token and attaches the claims.
2. Replace `actor: 'user:anonymous'` with `user:${claims.sub}` so receipts and
   audit lines name a real principal.
3. Declare the new surface in `surfaces:` in `onklave.yaml` and give it its own
   directory (`architecture/boundaries.md`).
4. Keep authorization in this app's own tables, keyed by the token's `sub`.
   Identity lives in the realm; permissions live here.

## Rules

- Identity is resolved **server-side, from a verified token**. A user id in a
  request body or a query parameter is an input, never an identity.
- The client may hide a control; only the server may refuse an operation.
- The client secret, and any other credential, never reaches the browser — the
  `web` service declares no `env` at all, and that is deliberate.
- Authorization decisions belong next to the operation, in the action boundary
  or a guard, not scattered through presentation code.
