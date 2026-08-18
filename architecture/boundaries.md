# Boundaries

Where the trust line is, and which direction imports may cross it.

## The trust line

```
browser  ── untrusted ──▶  api (server/)  ── ActionExecutor ──▶  provider / PostgreSQL
```

The browser is not a trusted execution environment. It renders, it collects
input, it asks. Every decision that matters — is this allowed, is this still
valid, what is the real value — is made in `server/`.

## Deployment shape

Two services, two images, **one host**, joined only at request time by
`expose.path` in `onklave.yaml`:

| Path | Service | Port | Health |
|---|---|---|---|
| `/` | `web` — Angular static bundle | 3000 | `/health` |
| `/api` | `api` — NestJS + PostgreSQL | 8080 | `/api/healthz` |

Three consequences, all load-bearing:

1. **The route prefix is not stripped.** `/api/items` arrives at the container
   as `/api/items`. Hence `app.setGlobalPrefix('api')` in `server/src/main.ts`
   and hence the health path. Removing the prefix 404s everything in production
   while working on localhost.
2. **Calls are same-origin, so there is no CORS configuration** anywhere and
   none is needed. See `decisions/ADR-0002-no-cors.md`.
3. **One auth gate** in front of the host covers both services: the page load
   and the API call are authenticated by the same session.

## Surfaces

`onklave.yaml` declares one surface, `public`. The app itself does not
distinguish an anonymous caller from an authenticated one — the perimeter does.

To add a real surface (`authenticated`, `admin`):

1. add it to `surfaces:` in `onklave.yaml`;
2. add authentication (`architecture/auth.md`) — a declared surface with no
   check is a lie;
3. give it its own directory under `server/src/` and its own guard, rather than
   an `if (isAdmin)` sprinkled through existing controllers;
4. keep the crossing explicit: one place converts a session into an identity,
   and everything downstream receives the identity.

## Import rules

**These are machine-enforced.** `server/test/architecture.test.ts` walks the
import lines of `server/src/` and `client/src/` and fails the build on any of
them — it is `npm run architecture-test`, and `architecture-test` in
`validation:` in `onklave.yaml`. A rule stated only in prose does not fail
anything, and an agent that has not read this file is not stopped by it.

| Rule | Why |
|---|---|
| `client/` never imports from `server/` and vice versa | Two independently built images; a shared import would compile server code into a public bundle. |
| Controllers never import a provider **as a value** | They would bypass policy, approval, the re-check and the audit record. Ask `ActionExecutor` for a capability. An `import type` is allowed — it is erased at compile time, so it cannot call anything, and `items.controller.ts` borrows `EmailMessage` that way. |
| `providers/` imports only its own siblings and `actions/action.types` | An adapter is a leaf: input in, result out. It must stay swappable. |
| Nothing outside `db.ts` constructs a `Pool` | One pool, one place that reads `DATABASE_URL`. |
| `client/` reads no `process.env` or `import.meta.env` at all | A browser bundle is public, so there is no such thing as a secret build-time value in it. The error-tracking key is fetched at runtime instead. |
| Nothing reads a secret except through `process.env`, by a name declared in `credentialRefs` and `onklave.yaml` | So a missing secret blocks the deploy instead of failing on first use. |

The same suite checks three things that are not import rules but rot the same
way: that `capabilities:` in `onklave.yaml` is exactly the key set of
`ACTION_POLICY`, that every `validation:` step names a real npm script, and
that the prohibitions in ADR-0002 (no CORS) and ADR-0003 (no workflows) still
hold.

When a rule here is wrong, change this table and that file together. Changing
only the test moves the rule somewhere nobody reads.

## What crosses the line

Only HTTP, and only these shapes:

- reads → JSON, with a `Cache-Control` header stating the freshness class
  (`architecture/data-freshness.md`);
- writes → the created resource;
- governed operations → an **action receipt** whose `state` is the answer
  (`architecture/actions.md`).

Nothing else. No credential, no provider identity the client can choose, no
policy decision made on the client.
