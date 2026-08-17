# ADR-0008 — Action receipts are durable; approvals are still not

**Status:** Accepted — supersedes the receipts half of ADR-0006

## Context

ADR-0006 put both pieces of action state in a `Map` and recorded the limit
honestly: correct for one replica, wrong for several. That was a reasonable
trade while the executor was being written, but it left the template shipping a
**default that is wrong the first time anyone scales `api` to two pods** — and
scaling a Deployment is a routine act that gives no hint it has just broken
idempotency. A starter's defaults are the thing customers keep.

The upgrade path ADR-0006 wrote down turned out to cost about ninety lines,
because this app already has PostgreSQL, already asserts its schema at boot, and
already refuses to start without a database.

Writing it also exposed a bug the `Map` had all along: `execute()` reads the key,
then `await`s the re-check and validation, and only then writes it. Two requests
can both pass the read. The single-process version was never actually safe
against a double-submitted click, only *usually* safe.

## Decision

**Receipts live in PostgreSQL.** `server/src/actions/receipt-store.ts` defines a
three-call `ReceiptStore` — `find`, `reserve`, `complete` — with two
implementations: `PostgresReceiptStore` (wired in `app.module.ts`) and
`InMemoryReceiptStore` (unit tests, and any process with no database).

```sql
CREATE TABLE IF NOT EXISTS action_receipts (
  execution_key TEXT PRIMARY KEY,   -- action-id + revision + capability
  receipt       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`reserve` is `INSERT … ON CONFLICT DO NOTHING RETURNING`. A row back means this
caller holds the key and may proceed; no row means someone else does, and the
caller is handed **their** receipt and executes nothing. The atomicity is the
primary key's, not this code's.

The table is asserted at boot from `main.ts`, next to the items schema —
the same migrations-lite pattern, and the reason there is **no "table missing"
fallback**. A store that silently degrades to a `Map` when a query fails would
be a store that silently stops being idempotent, which is the failure this
class exists to prevent. The app already exits non-zero when PostgreSQL is
unreachable; one more asserted table changes nothing about that contract.

**Approvals stay in a `Map`** (`ApprovalStore`). Nothing in this app grants one
outside a single request, so durability would be storage for a value with no
writer. Persist it — with an expiry, which receipts do not need — the moment
approvals are granted through a separate human workflow.

## Consequences

- The same `actionId` cannot execute twice across replicas, across restarts, or
  across the `await` inside one process. That is the whole point of the
  execution key, and it is now true rather than nearly true.
- One extra round trip per governed action (the reserve) and one on completion.
  A governed action already talks to an external system; this is not the cost
  that matters.
- **`action_receipts` grows one row per governed action and nothing prunes it.**
  Add a retention job when volume justifies one, and do not set the window
  shorter than the period in which a client might retry.
- Unit tests are unaffected: they construct `ActionExecutor` with
  `InMemoryReceiptStore`, and `receipt-store.test.ts` asserts the SQL that makes
  the PostgreSQL one atomic.
- The executor's shape did not change — `find` / `reserve` / `complete` sit
  exactly where the `Map` calls sat. ADR-0006 predicted a substitution rather
  than a rewrite, and that held.
