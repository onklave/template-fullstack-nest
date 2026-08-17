---
name: modify-schema
description: Change the PostgreSQL schema — add a column, a table or an index.
---

# Modify the schema

**Class B**, and Class D if the change can destroy data.

## What exists today

Two tables, both asserted at boot:

```ts
// server/src/items/items.service.ts        — the domain
async ensureSchema(): Promise<void> {
  await this.pool.query(`CREATE TABLE IF NOT EXISTS items (…)`);
}

// server/src/actions/receipt-store.ts      — action idempotency (ADR-0008)
//   action_receipts (execution_key TEXT PRIMARY KEY, receipt JSONB, …)
```

`main.ts` calls both before listening and exits non-zero if PostgreSQL is
unreachable. Leave `action_receipts` alone unless the action boundary itself is
the task: its primary key is what stops a governed action executing twice. This is migrations-lite, and it is deliberate: the container has no
writable disk and is replaced on every deploy, so schema cannot live in a local
migration state file.

## The rule

**Additive and idempotent only.** Every statement must be safe to run on every
pod start, on every replica, forever:

```sql
CREATE TABLE IF NOT EXISTS …
ALTER TABLE items ADD COLUMN IF NOT EXISTS note TEXT
CREATE INDEX IF NOT EXISTS items_created_at_idx ON items (created_at)
```

Never in `ensureSchema()`: `DROP`, a destructive `ALTER … TYPE`, a `NOT NULL`
without a default on a populated table, or anything that would fail if it ran
twice or ran concurrently on two replicas. A pod that cannot assert its schema
does not start — a bad statement there is an outage, not a failed migration.

## Rolling deploys

Old and new code run at the same time during a rollout. So:

1. Add the column (nullable, or with a default).
2. Deploy code that writes both and reads either.
3. Backfill.
4. Only then make it required, in a later change.

A rename is an add + backfill + remove across three deploys, never a rename.

## Destructive changes

Dropping a column or a table, or any statement that loses data, does **not**
belong in `ensureSchema()`. Take it out of the boot path, run it deliberately,
and treat it as Class D: human approval, and a plan for the data.

## When it stops being one table

Swap this for a real migration tool (node-pg-migrate, Umzug) once the schema is
more than a couple of tables, and record the change in `decisions/`. Do it as
its own change, not folded into a feature.

## Checklist

- [ ] Statement is `IF NOT EXISTS` / `IF EXISTS`, safe to re-run and to run
      concurrently.
- [ ] Existing rows remain valid.
- [ ] Old code still works against the new schema for the length of a rollout.
- [ ] The wire shape is unchanged, or the client change ships in the same PR.
- [ ] `server/test/items.test.ts` still passes against the fake `Pool`, and
      asserts the new statement.
- [ ] Nothing destructive is in the boot path.
