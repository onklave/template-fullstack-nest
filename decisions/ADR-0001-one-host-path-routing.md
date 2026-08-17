# ADR-0001 — Two services, one host, routed by path

**Status:** Accepted

## Context

The app is a browser bundle plus an API. They could be two hosts (`app.example`
and `api.example`) or one host split by path.

## Decision

One host per (project, environment). `web` answers on `/`, `api` on `/api`,
declared by `expose.path` in `onklave.yaml`. They remain two images, two
Deployments and two rollouts — joined only at request time.

The route prefix is **not** stripped before it reaches the container, so the API
mounts every route under `/api` (`app.setGlobalPrefix('api')`), including its
health check at `/api/healthz`.

## Consequences

- The browser's calls to `/api` are same-origin: the session that authenticated
  the page authenticates the call, and no key travels in the bundle.
- Both services sit behind one forward-auth gate, so the perimeter is one thing
  rather than two that can disagree.
- An API mounted at `/` works perfectly on localhost and 404s on everything in
  production — including the probe, which fails the rollout with an error that
  never mentions the prefix. This is the single easiest thing to get wrong here.
- Exactly one service may claim `/`. A third service needs its own prefix, or
  `expose.enabled: false`.
