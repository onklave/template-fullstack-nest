# AGENTS.md

The entry point for an agent working in this repository. Read this file, then
read **only** the one skill and the one or two architecture documents your task
points to. Everything here is short on purpose; the detail lives one hop away.

---

## 1. What this application is

A two-service web app: an Angular single-page client (`client/`, service `web`)
and a NestJS + PostgreSQL API (`server/`, service `api`). They are built as two
images and deployed as two workloads behind **one host**, joined by path:
`/` → web, `/api` → api. `onklave.yaml` is the whole deployment contract.

Functionally it is an items list plus one governed side effect (emailing
someone about an item) — the smallest thing that exercises every rule below.

## 2. Surfaces

One: `public` (declared in `onklave.yaml`). The app draws no distinction of its
own between callers; its perimeter is the Onklave gate in front of the shared
host. Adding an `admin` or `authenticated` surface is a real change, not a word
in a manifest → `architecture/boundaries.md`, `architecture/auth.md`.

## 3. Where state lives

| State | Home | Notes |
|---|---|---|
| Application data | PostgreSQL, reached via `DATABASE_URL` | The authority. |
| Schema | asserted at boot: `ItemsService.ensureSchema()` + the receipt store's | Two tables → `skills/modify-schema/` |
| Client state | Angular signals in `client/src/app/app.ts` | A **projection** of server truth, never a second source of it. |
| Action receipts | PostgreSQL, `action_receipts` | The idempotency record. Claimed with `ON CONFLICT DO NOTHING`, so a duplicate action cannot execute twice across replicas → `decisions/ADR-0008-durable-action-receipts.md`. |
| Approvals | `ApprovalStore` (in-process) | Granted and consumed within one request. Persist before that changes → `decisions/ADR-0006-in-process-action-state.md`. |
| Secrets | Onklave vault → `process.env` at boot | Never in this repo. See §5. |

Nothing is written to local disk: containers are replaced on every deploy.

## 4. Which directories own what

| Path | Owns |
|---|---|
| `client/src/app/` | Presentation. Free to redesign (see `DESIGN.md`). |
| `server/src/items/` | The `items` domain: routes + persistence. |
| `server/src/actions/` | The action boundary — policy, approval, re-check, idempotency, audit. |
| `server/src/app.setup.ts` | The HTTP surface (`/api` prefix, body limit, error filter). Shared by `main.ts` and the e2e tests so they cannot drift. |
| `server/src/providers/` | Capability adapters and the registry. The only code that talks to an external system. |
| `server/src/db.ts` | `DATABASE_URL` and the pg pool. |
| `server/src/onklave.ts` | Platform runtime wiring (secrets + error tracking). |
| `server/src/api-exception.filter.ts` | The one place an exception becomes an HTTP response. |
| `server/src/app.module.ts` | **Governance wiring**: `ACTION_POLICY` (what this app may do) and the registered providers (what does it). |
| `onklave.yaml` | The deployment + governance contract the platform reads. |

## 5. What may never run in the browser

- **A credential of any kind.** The `web` service declares no `env` at all, and
  it must stay that way: a browser bundle is public. Even the error-tracking
  ingest key is fetched at runtime from `/api/onklave/config`.
- **A privileged or irreversible operation.** Sending mail, charging, deleting,
  calling a third-party API: server-side only, through `ActionExecutor`.
- **Authorization decisions.** The client may hide a button; only the server may
  refuse.

## 6. Which operations require a capability

Anything with an external side effect. Capabilities are declared twice and must
agree: `capabilities:` in `onklave.yaml`, and `ACTION_POLICY` in
`server/src/app.module.ts` — the table the runtime actually enforces. **A
capability that is not in that table cannot execute**, however it is called.

Today: `email.send` (`automatic` — no human approval). Application code asks for
the capability; it never names an adapter → `architecture/providers.md`.

## 7. Where the tests are

- `server/test/*.test.ts` — `node:test` via ts-node, no live database needed
  (the seam is the `PG_POOL` provider). `npm test` runs all of them.
  - `action-executor.test.ts` — the governance rules, provider-independent.
  - `architecture.test.ts` — the import rules in `architecture/boundaries.md`,
    machine-enforced, plus the manifest/code agreement checks. Reads `client/`
    and `onklave.yaml` too: it is a repository test hosted in the API's runner.
    Also `npm run architecture-test`.
  - `governance.e2e.test.ts` — the few governance properties that only exist at
    the HTTP boundary. Boots the real `AppModule` on an ephemeral port; no
    browser, no database, no deployed environment. Also `npm run e2e`.
  - `provider-contract.ts` — the shared contract **every** adapter must pass.
  - `receipt-store.test.ts`, `providers.test.ts`, `items.test.ts`,
    `api-exception.filter.test.ts`, `onklave-config.test.ts`.
- `client/src/**/*.spec.ts` — vitest + jsdom, headless.

## 8. Commands that validate the repository

Run from the service directory. Between them these are the six steps
`validation:` in `onklave.yaml` names.

```bash
cd server && npm ci && npm run lint && npm test && npm run build
cd client && npm ci && npm run typecheck && npm test && npm run build
```

(`server`'s `lint` is `tsc --noEmit` over `src` and `test`; the client's
equivalent is `typecheck`. `npm test` in the server is a superset — it runs
`architecture-test` and `e2e` too; those exist as separate scripts so a
boundary or HTTP failure can be run, and read, on its own.) Nothing may be
reported as done until both pass.

**Node version.** `/.nvmrc` pins **24** — run `nvm use` before anything else.
Each service declares its own floor in `engines` (`api` ≥ 22, `web` ≥ 22.22.3,
which is `@angular/cli`'s), and each has an `.npmrc` with `engine-strict=true`,
so an unsupported Node fails at `npm ci` with a message naming the version
required, rather than several steps later inside a tool. Do not remove either
file, and never put a registry token in an `.npmrc` — they are committed and
copied into the Docker build context.

## 9. Which documents are authoritative

In precedence order:

1. `onklave.yaml` — deployment + declared governance. The platform reads it.
2. `architecture/` — the rules. `boundaries.md`, `data-freshness.md`,
   `auth.md`, `actions.md`, `providers.md`.
3. `decisions/` — why the rules are what they are. An ADR beats a comment.
4. This file — orientation and routing.
5. `README.md` — human onboarding. `DESIGN.md` — the product, and what may be
   redesigned freely.

Code comments describe the code; where a comment and an ADR disagree, the ADR
wins and the comment is a bug.

## 10. Which changes require human approval

| Class | Examples | Gate |
|---|---|---|
| A — presentation | CSS, copy, layout, components | Autonomous |
| B — application logic | a feature, a new route, a schema change | Normal review |
| C — capability | a new entry in `capabilities:` / `ACTION_POLICY`, a new provider | Explicit capability review |
| D — sensitive | credentials, authorization, billing, destructive operations, `onklave.yaml` governance fields, production deploy | **Human approval** |

Anything touching `server/src/actions/`, `server/src/providers/`, `server/src/db.ts`
or `onklave.yaml` is C or D. Say so in the PR description rather than hoping it
is noticed.

---

## Pick your task

| Task | Read |
|---|---|
| Add or change a feature, a route, a screen | `skills/add-feature/SKILL.md` |
| Integrate an external system (email, payments, storage) | `skills/add-provider/SKILL.md` |
| Add an operation with a real side effect | `skills/add-sensitive-action/SKILL.md` |
| Change the database schema | `skills/modify-schema/SKILL.md` |
| Ship it | `skills/deploy/SKILL.md` |

Three rules that catch out every newcomer, human or otherwise:

1. **The `/api` prefix is not stripped.** Every API route lives under `/api`,
   including the health check. An API mounted at `/` works perfectly on
   localhost and 404s on everything in production.
2. **There is no CORS configuration and none is needed** — the client and API
   are same-origin. Reaching for `enableCors()` means the routing is wrong.
3. **There is no `.github/workflows/` and one must not be added.** Onklave
   builds, tests and deploys in-cluster from `onklave.yaml`.
