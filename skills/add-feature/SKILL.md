---
name: add-feature
description: Add or change a screen, a route or a piece of application logic that has no external side effect.
---

# Add a feature

For work with **no external side effect**. The moment it sends, charges,
deletes or calls out, stop and use `skills/add-sensitive-action/SKILL.md`
instead.

Usually **Class A** (presentation) or **Class B** (application logic).

## Where things go

| Kind of change | Place |
|---|---|
| Layout, copy, styling, components | `client/src/app/` — free rein, see `DESIGN.md` |
| Calling the API from the browser | `client/src/app/items.service.ts` — relative paths only, `/api/...` |
| A new read or write endpoint | `server/src/<domain>/` — a controller and a service, mirroring `items/` |
| Persistence | The domain service, through the injected `Pool` |
| Schema | `skills/modify-schema/SKILL.md` |

## Rules that apply even to harmless features

1. **Every API route lives under `/api`.** The global prefix is set once in
   `main.ts`; the platform does not strip it. A route mounted at `/` 404s in
   production and works on localhost.
2. **Relative URLs in the client.** `'/api/items'`, never
   `https://…/api/items`. An absolute URL creates a cross-origin call and the
   CORS problem that follows it. There is no CORS configuration in this repo
   and there must not be one.
3. **Classify every new read** — `static` / `display` / `live` / `transactional`
   — set the matching `Cache-Control`, and add the data class to `freshness:` in
   `onklave.yaml` if it is new. See `architecture/data-freshness.md`.
4. **The client is a projection.** After a write, take the server's returned
   value as the new truth rather than computing what you think it became.
5. **Errors are shaped in one place.** Throw an `HttpException` with an
   `{ error: '…' }` body; `api-exception.filter.ts` turns it into a response.
   Never write a `try/catch` that returns its own error shape, and never echo
   `err.message` to a client.
6. **Validation stays inline while it is small** — one or two fields, as in
   `items.controller.ts`. Reach for `ValidationPipe` + DTO classes when a
   payload grows past that, and do it for the whole domain at once.
7. **Ids are strings.** `BIGINT` exceeds 2^53; keep them strings end to end.

## Tests

- Server: a `node:test` file in `server/test/`, using the fake `Pool` seam —
  never a live database.
- Client: a vitest spec next to the code.

Cover the behaviour, and cover the failure the user will actually hit.

## Done means

```bash
cd server && npm run lint && npm test && npm run build
cd client && npm run typecheck && npm test && npm run build
```

Both green, and the diff touches nothing under `server/src/actions/`,
`server/src/providers/` or `onklave.yaml`. If it does, this was not a
Class A/B change — reclassify it and say so in the PR.
