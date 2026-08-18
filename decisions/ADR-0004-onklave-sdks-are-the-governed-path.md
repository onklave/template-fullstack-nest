# ADR-0004 — The Onklave SDKs are the governed path, not an optional extra

**Status:** Accepted

## Context

An app can read secrets with `dotenv`, log errors with `console.error`, and
hand-roll an OIDC flow. All three work, and all three quietly opt the app out of
the platform's guarantees: secrets end up in files, errors end up nowhere, and
credential handling ends up in application code.

## Decision

Two published libraries are dependencies of the `api` service and are the
**default** way this app does these things:

| Concern | Use | Not |
|---|---|---|
| Secrets | `injectOnklaveSecrets()` — `server/src/onklave.ts` | `dotenv` in production; a secret in client code; a secret in the repo |
| Error reporting | `OnklaveErrors` + `ApiExceptionFilter` | a bare `console.error` in a request path |
| Identity (when added) | `getOidcConfig()` / `publicOidcConfig()` / `verifyAccessToken()` | a hand-rolled token flow, a password form |

`@onklave/errors` is also a dependency of the `web` service, initialised from
config fetched at runtime — never a key baked into the bundle.

The credential model in the Governed App Starter spec — *the agent may know
`credential_ref`, never the value* — is exactly what `injectOnklaveSecrets()`
implements: the pod presents its projected Kubernetes ServiceAccount token,
vault returns the `(org, project, environment)` map encrypted to an ephemeral
key only that process holds, and the values arrive in `process.env`. The
repository contains the **names** (`credentialRefs`, `env:` in `onklave.yaml`)
and nothing else.

## Consequences

- Every SDK entry point is a **silent no-op off-platform**, so local development,
  tests and CI run unchanged with no Onklave environment set. Anything added
  must degrade the same way — that property is what keeps this a usable
  template.
- The libraries are ordinary public npm packages; versions are pinned in each
  service's lockfile and refreshed deliberately, with the result recorded in
  `.onklave/audit.md`.
- Replacing one of them is a Class D change: it moves credential handling or
  audit out of the governed path.
