# Template audit

- **Last audited:** 2026-08-17 (SDK currency refresh — see below)
- **Initial audit:** 2026-08-09
- **Audited by:** Onklave platform maintenance (automated, Claude Code)
- **Next review due:** 2026-11-09 (quarterly, or sooner on a dependency alert)

## Why this file exists
So we know when this template was last deliberately checked, and what was true at
the time. Apps are generated from this repo — stale or vulnerable dependencies
here propagate to every app created from it.

---

## 2026-08-17 — SDK currency refresh (Governed App Starter P0)

The lockfiles pinned the SDKs at the versions published when the template was
built. Both are now on the current release, and the declared ranges were lifted
to the versions actually verified here so a fresh resolve cannot land below them.

| Package | Was | Now | Where |
|---|---|---|---|
| `@onklave/errors` | 0.1.0 | **0.1.3** | `server` + `client` |
| `@onklave/app-runtime` | 0.1.0 | **0.1.1** | `server` |

**API deltas — none breaking.**

- `@onklave/errors` 0.1.0 → 0.1.3 is purely additive: a new `./widget` subpath
  export, `submitFeedback()` / `getFeedbackEnabled()` on the client and the
  singleton, and the `FeedbackCategory` / `FeedbackPriority` types. `Transport`
  gained an optional `body` and `json()` for the bodyless feedback-config probe.
  Everything this template uses — `OnklaveErrors.init/captureException`,
  `installGlobalHandlers` (browser), `OnklaveExceptionFilter` (nestjs) — is
  unchanged, so no code adaptation was needed. Nothing here consumes the
  feedback surface yet; the client bundle grew 143.47 kB → 144.12 kB.
- `@onklave/app-runtime` 0.1.0 → 0.1.1 is documentation only (README status
  line: vendored → published). No signature changed.

Also picked up in the same pass: `nanoid` 3.3.17 → 3.3.18 in the client (via
`npm audit fix`, transitive dev dependency of `@angular/build` → `postcss`),
clearing **GHSA-2v37-7h3g-55p8** (high). The three moderate dev-only advisories
noted in the initial audit no longer appear. Both services now report **0
vulnerabilities**.

**Re-verified after the refresh**, from a clean `npm ci` in each service:

| Check | Result |
|---|---|
| API install / lint / test / build | Pass — 0 vulnerabilities, **39/39** tests, 16 suites |
| Client install / typecheck / test / build | Pass — 0 vulnerabilities, **5/5** tests, 144.51 kB initial (42.84 kB transferred) |
| `server/Dockerfile` image build | Pass |
| Image contents / user | `dist`, `node_modules`, `package.json` only; `uid=1000(node)` |
| Runtime against PostgreSQL 17, **no Onklave env set** | Boots, serves `/api/*`, `/api/onklave/config` 404s — the off-platform no-op path holds |
| Governed action end to end | `POST /api/items/:id/notify` → 200 + receipt; identical retry → same receipt, **exactly one** provider send; deleted target → 422 `failed`, nothing executed |
| Audit lines | One structured line per governed execution, no payload; **0** occurrences of the connection string in logs |
| SIGTERM | Exits 0 (pool drained) |
| `onklave.yaml` | Valid against the platform validator (`@onklave/shared-dto` `validateOnklaveContract`), all six governance fields parsed, 0 errors |

The client toolchain requires Node ≥ 22.22.3 (`@angular/cli`); it was verified on
Node 24.15.0. The API was verified on Node 22.22.0 and in `node:22-alpine`.

Open items from the initial audit are unchanged: the `web` image still has not
been Docker-built from this repo, and image-layer CVE scanning is still not
wired into a pipeline.

---

## Scope of this audit
This is the **initial audit**, run as the template was created (derived from
`template-fullstack-angular`, with the Express API replaced by NestJS), so it
covers construction as well as currency.

- Clean install, build, test and typecheck of both services.
- Docker build of the `api` image, plus runtime verification against a
  throwaway PostgreSQL 17 container (the `web` service is byte-identical in
  mechanism to the audited template-fullstack-angular client and was verified
  by build + tests).
- Live verification of the **HTTP contract** against the Express reference:
  same routes, status codes, validation limits and JSON shapes, `/api` prefix
  not stripped, database bound to `api` only.
- Browser error-tracking wiring: `/api/onklave/config` 404s without a key,
  returns the config with one; the client bundle contains the runtime fetch and
  no baked-in key.
- Dependency currency and vulnerability status (`npm audit`) for both services.
- Secret hygiene: committed secrets, secrets in logs, fail-fast without config.
- Not in scope: OS-package CVE scan of built images; load or soak testing;
  Docker build of the unchanged `web` image.

## Verification run
Every row below was executed; results are the real observed output.

**Build and test**

| Check | Command | Result |
|---|---|---|
| API clean install | `npm install` (server) | Pass — **0 vulnerabilities** |
| API build | `npm run build` (tsc) | Pass — clean, `strict: true` |
| API lint | `npm run lint` (tsc --noEmit, src + test) | Pass |
| API tests | `npm test` (node:test via ts-node) | Pass — **11/11**, 6 suites, no live PostgreSQL |
| Client clean install | `npm install` (client) | Pass — 3 moderate advisories, dev-only chain (inherited Finding #1 of template-fullstack-angular) |
| Client production build | `npm run build` | Pass — 143.47 kB initial, 42.64 kB transferred → `dist/browser`; no CommonJS warnings (`@onklave/errors` allow-listed) |
| Client typecheck | `npm run typecheck` | Pass |
| Client tests | `npm test` (vitest + jsdom) | Pass — 2 files, **5/5** |

**The HTTP contract** — exercised live against PostgreSQL 17 (`docker run
postgres:17-alpine`), compiled output (`node dist/main.js`):

| Check | Result |
|---|---|
| `GET /api/healthz` | 200 `{"status":"ok"}` |
| `GET /healthz`, `GET /items` (unprefixed) | **404** `{"error":"Not Found"}` — prefix is not stripped and not optional |
| `GET /api/items` | 200 `[]`, then rows newest-first after writes |
| `POST /api/items` valid name | 201, name trimmed, **id is a string**, ISO `createdAt` |
| `POST /api/items` blank / >200 chars | 400 `{"error":"name must be 1-200 characters"}`, nothing stored |
| `GET /api/nope` | 404 `{"error":"Not Found"}` |
| `GET /api/onklave/config` without key | 404 `{"error":"Not Found"}` |
| `GET /api/onklave/config` with key | 200 `{"errorsIngestKey":…,"environment":…,"release":…}` |
| Store failure (db stopped) | 500 `{"error":"Internal Server Error"}`; no SQL, host or password in the body or logs |
| Framework fingerprint | No `X-Powered-By` header |
| Secret not logged | 0 occurrences of the connection string in server logs |
| SIGTERM | Exits gracefully (shutdown hooks drain the pg pool) |

**Image (`server/Dockerfile`, node:22-alpine)**

| Check | Result |
|---|---|
| Build | Pass |
| Contents | Only `dist`, `node_modules`, `package.json` — no `src`, no `test/`, no `.git` |
| Non-root | `uid=1000(node) gid=1000(node)` |
| Runtime | `/api/healthz` and `/api/items` 200 against PostgreSQL; rows written by an earlier process still present (no local state) |
| Fail-fast without config | Exits **1** with `DATABASE_URL is not set…`; no in-memory fallback |

## Dependency status

**`server` (api)** — 0 vulnerabilities.

| Package | Version | Notes |
|---|---|---|
| @nestjs/* | ^11.0.0 | current major |
| pg | ^8.22.0 | current |
| @onklave/app-runtime | ^0.1.1 | published SDK (refreshed 2026-08-17) |
| @onklave/errors | ^0.1.3 | published SDK (refreshed 2026-08-17) |
| typescript / ts-node | ^5.7.0 / ^10.9.2 | dev-only |

**`client` (web)** — unchanged from `template-fullstack-angular` (Angular
^22.1.0 toolchain) plus `@onklave/errors@^0.1.3` at runtime. The dev-only
advisory chain inherited from that template is clear as of 2026-08-17.

## Findings

1. **(design, resolved during construction) The SDK's `OnklaveExceptionFilter`
   cannot be registered directly as the only global filter.** It reports and
   then rethrows; a global catch-all filter that rethrows escapes Nest's
   response pipeline, and Express's default handler answers with an HTML stack
   trace — verified live (400/404s became HTML pages leaking file paths). This
   matches the platform's own finding (`error-reporting.ts` uses an interceptor
   for the same reason). **Action taken:** `ApiExceptionFilter` subclasses the
   SDK filter — capture is delegated to `super.catch()` for 5xx, the response
   shape is owned locally — and a test pins each wire shape.

2. **(low, deliberate) Malformed JSON and oversized bodies return Nest's
   mapped 4xx** (400 `{"error":"Bad Request"}` / 413) where the Express
   reference returned 500 for body-parser failures. The 4xx is the more honest
   status; the client never sends either. Shapes still follow the
   `{"error": …}` contract.

3. **(low, deliberate) 4xx are not reported to error tracking.** They are
   deliberate control flow (matching both the Express template, which captures
   only in its 500 handler, and the platform's `isExpectedClientError` rule).

4. **(informational) The API has no authentication of its own.** It relies on
   the Onklave gate in front of the shared host — correct as long as both
   services stay behind one gate. An app that exposes `api` on its own host
   must add its own authorization.

**Verified clean (no action needed):**
- No secrets committed; `.env.example` carries an obvious placeholder.
- No secret reaches the browser: the `web` service declares no `env`, and the
  error-tracking key is fetched at runtime from the API (rate-limited,
  submit-only) rather than baked into the bundle.
- `DATABASE_URL` never logged; error bodies never echo `err.message`.
- API container runs non-root; nothing written to local disk.
- No CORS anywhere; no `.github/` directory.
- HTTP timeouts set (`keepAlive` 10 s < `headers` 20 s < `request` 30 s).

## Open items
1. **Docker-build the `web` image in the next audit pass** — unchanged from the
   already-audited Angular template, but it has not been rebuilt from this repo.
2. **Re-check the `@angular/cli` dev-only advisory chain** inherited from
   `template-fullstack-angular` at the next audit.
3. **Wire an authenticated image CVE scan** (Trivy/Grype/Scout) into whatever
   pipeline builds template images — npm-level dependencies are clean, the
   Alpine base layers were not scanned.
