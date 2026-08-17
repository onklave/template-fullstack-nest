# ADR-0006 — Action receipts and approvals are held in process

**Status:** Superseded in part by
[ADR-0008](./ADR-0008-durable-action-receipts.md) — **receipts are now in
PostgreSQL**. Approvals are still held in process, and the reasoning below still
governs them. Kept because it records why the executor was shaped so the
substitution was cheap when it came.

## Context

`ActionExecutor` needs two pieces of state: which execution keys have already
run (idempotency) and which have a human approval. The obvious durable home is
PostgreSQL — a table with a unique index on the execution key, which would also
give receipts a permanent audit home.

That is a table, a schema assertion, a store class and a database dependency
inside the action boundary. This is a starter, and the executor's value comes
from being short enough to read and edit.

## Decision

Both live in memory inside the process: a `Map` in `ActionExecutor` and a `Map`
in `ApprovalStore`. Every receipt is also written to stdout as a structured
audit line, which the platform collects — so the *audit trail* is durable even
though the *state* is not.

## Consequences

**This is correct for one replica and wrong for several.** Two replicas do not
share the map, so the same `actionId` can execute once on each. A restart clears
it, so a retry after a restart can execute again.

Before either of these is true — scaling `api` past one replica, or registering
an adapter with a real, costly side effect (payments, production email, external
mutations) — move the store to PostgreSQL:

```sql
CREATE TABLE IF NOT EXISTS action_receipts (
  execution_key TEXT PRIMARY KEY,   -- action-id + revision + capability
  receipt       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Reserve the key with `INSERT … ON CONFLICT DO NOTHING` and treat "no row
inserted" exactly as the current `Map` hit is treated. The executor's logic does
not otherwise change — the shape was chosen so this is a substitution, not a
rewrite.

Approvals need the same treatment plus an expiry the moment they are granted
through a separate human workflow rather than within one request.

---

**What happened:** the receipts half was taken, in ADR-0008 — the substitution
above, near enough verbatim, at about ninety lines. The estimate that a starter
could not afford it was wrong, and it hid a real defect: the `Map` was read and
written either side of an `await`, so even one process could execute a
double-submitted action twice. Approvals remain in a `Map`, for the reason above
and because nothing here grants one outside a single request.
