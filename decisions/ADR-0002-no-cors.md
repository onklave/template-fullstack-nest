# ADR-0002 — No CORS configuration

**Status:** Accepted — follows from ADR-0001

## Context

Most Angular + API templates ship an `enableCors()` call, because the two halves
are developed on different ports and deployed to different hosts. Once it is
there it tends to stay, usually widened to whatever made the error go away.

## Decision

There is no CORS configuration in this repository, and none may be added. The
client calls the API with **relative** URLs (`/api/items`), same-origin, because
both services answer on one host (ADR-0001).

`ng serve` runs on a different port during development, so
`client/proxy.conf.json` forwards `/api` to `localhost:8080`. That file is
dev-only and has no `pathRewrite` — the platform does not strip the prefix
either, so development and production agree on the URLs.

## Consequences

- No preflight, no origin allowlist to maintain, no `*` to regret.
- An absolute URL in the client re-creates the problem. Keep `API_BASE = '/api'`.
- **If you find yourself reaching for `enableCors()`, the routing is wrong.**
  Check `expose.path` in `onklave.yaml` before loosening any origin policy.
- An app that genuinely needs a second origin (a separate mobile client, say) is
  a different architecture and needs its own ADR — not a quiet CORS call.
