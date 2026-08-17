---
name: deploy
description: Ship this app — how it is built and deployed, and what to change when the shape changes.
---

# Deploy

**Class D.** `onklave.yaml` declares `approvals: { deploy.production: required }`:
production deployment needs a human.

## How it works

Onklave reads `onklave.yaml`, clones the repo, builds **each service's image
in-cluster** from that service's own build context and Dockerfile, runs the
validation steps, then renders a Deployment, Service and Ingress rule per
service.

There is **no `.github/workflows/`** and one must not be added: a workflow file
cannot declare a service, and the platform's credential cannot push one. See
`decisions/ADR-0003-no-github-actions.md`.

## Before proposing a deploy

```bash
cd server && npm ci && npm run lint && npm test && npm run build
cd client && npm ci && npm run typecheck && npm test && npm run build
```

These are the four steps `validation:` declares, in order. A change is not
finished until both services are green from a clean `npm ci`.

Then check:

- [ ] every new secret is declared in the right service's `env:` with
      `required: true, secret: true`, and its **value** is stored in the project's
      environment settings — not in the repo;
- [ ] `capabilities:` / `approvals:` in `onklave.yaml` still match
      `ACTION_POLICY` in `server/src/app.module.ts`;
- [ ] no `env` was added to the `web` service — its output ships to the browser
      and anything declared there is public;
- [ ] the API's `healthPath` is still under its route prefix (`/api/healthz`);
- [ ] `AGENTS.md` and `architecture/` still describe reality.

## Changing the deployment shape

Adding a service: append an entry to `services:` with its own `build.context`
and `build.dockerfile`. Exactly one service may claim `path: /`; everything else
needs a distinct prefix and must serve its routes **under** that prefix, because
the prefix is not stripped. A worker takes `expose.enabled: false`.

Adding a secret: declare the name in `env:`; never the value.

Changing a governance field (`surfaces`, `freshness`, `capabilities`,
`approvals`, `agent`, `validation`): Class D. These are what the platform reads
to decide what an agent may do here, so a change that makes a declaration untrue
is worse than no declaration. Governance names are lowercase and dotted, and a
colon is rejected — a validation step is `e2e`, never `test:e2e`.

## Runtime facts worth knowing

- `DATABASE_URL` is injected per environment; the API exits non-zero without it
  rather than falling back to memory.
- Secrets arrive in `process.env` at boot via `injectOnklaveSecrets()`
  (`server/src/onklave.ts`), which is a silent no-op off-platform.
- Both images run non-root and write nothing to local disk.
- `SIGTERM` drains the pg pool through Nest's shutdown hooks.
- Errors reach Onklave error tracking through `ApiExceptionFilter` (5xx only)
  and `OnklaveErrors.captureException` in the action boundary.

## If it does not come up

Check, in this order: the probe path against `expose.path`; a required secret
with no stored value; the schema assertion at boot; then the pod logs. Diagnose
from logs and code — not from clicking around the deployed app.
