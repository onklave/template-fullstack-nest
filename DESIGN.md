# DESIGN.md

What this application is for, and which parts of it are yours to redesign.

Replace this file's first section as the product takes shape; keep the second.

## The product

An items list. A visitor sees the items, adds one, and can have a note about an
item emailed to someone. That last operation is deliberately more machinery
than it looks: it is the worked example of a **governed action** — policy,
approval, an authoritative re-check, an idempotency key and an audit receipt —
so that the first real side effect this app grows has a pattern to copy.

## Visual system vs. hard-won logic

> Adapt the presentation; preserve the logic.

Two halves of this repository, and they are not equal.

**Free to change** — `client/src/app/` and `client/src/styles.css`: layout,
copy, components, styling, the shape of the screens, which framework renders
them. Redesign it entirely if that is the task. No governance rule lives here,
and none should be introduced here.

**Not free to change** — `server/src/actions/`, `server/src/providers/`,
`server/src/db.ts`, `server/src/api-exception.filter.ts`, `onklave.yaml`.
These encode decisions that took an incident or an audit to learn: server-first
execution, capability-scoped integrations, freshness classes, error responses
that leak nothing. A redesign task must not touch them; if a redesign appears
to require it, that is the thing to raise, not to route around.

The seam between the two is HTTP: the client sends a request and reads a
response (for a governed operation, a **receipt** whose `state` is the answer).
It never reaches past that seam — no credential, no provider, no policy
decision on the browser side.

See `architecture/boundaries.md` for where that line is drawn in code, and
`AGENTS.md` §10 for which side of it needs human approval.
