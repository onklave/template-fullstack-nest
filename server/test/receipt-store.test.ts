import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { ActionReceipt } from '../src/actions/action.types';
import { InMemoryReceiptStore, PostgresReceiptStore } from '../src/actions/receipt-store';

/**
 * The store behind action idempotency. What matters here is `reserve`: exactly
 * one caller may win an execution key, and every other caller must be handed
 * the winner's receipt rather than a licence to run the side effect again.
 *
 * The PostgreSQL store is exercised against a fake pool — the assertion is on
 * the SQL it issues, because the atomicity guarantee is PostgreSQL's primary
 * key, not this class's logic. Reproducing that in a fake would test the fake.
 */

const receipt = (over: Partial<ActionReceipt> = {}): ActionReceipt => ({
  actionId: 'act-1',
  capability: 'email.send',
  actor: 'user:1',
  revision: 'abc123',
  policy: 'automatic',
  state: 'executing',
  startedAt: '2026-08-17T00:00:00.000Z',
  ...over,
});

/** Records the SQL it is asked to run and replays canned rows. */
function fakePool(responses: Array<Array<Record<string, unknown>>> = []) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    queries,
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      return { rows: responses.shift() ?? [] };
    },
  };
  return pool;
}

describe('InMemoryReceiptStore', () => {
  test('the first caller wins the key and later callers get its receipt', async () => {
    const store = new InMemoryReceiptStore();
    const first = receipt();

    assert.equal(await store.reserve('k', first), undefined, 'first caller must win');
    assert.deepEqual(await store.reserve('k', receipt({ actor: 'user:2' })), first);
  });

  test('complete replaces the reserved receipt with the terminal one', async () => {
    const store = new InMemoryReceiptStore();
    await store.reserve('k', receipt());

    await store.complete('k', receipt({ state: 'completed' }));

    assert.equal((await store.find('k'))?.state, 'completed');
  });
});

describe('PostgresReceiptStore', () => {
  test('the schema it asserts is the execution key as a primary key', async () => {
    const pool = fakePool();
    await new PostgresReceiptStore(pool as unknown as Pool).ensureSchema();

    // Not decoration: the primary key IS the idempotency guarantee.
    assert.match(pool.queries[0].sql, /CREATE TABLE IF NOT EXISTS action_receipts/);
    assert.match(pool.queries[0].sql, /execution_key TEXT PRIMARY KEY/);
  });

  test('reserve claims the key with ON CONFLICT DO NOTHING, never a read-then-write', async () => {
    // One row back = the insert landed = this caller holds the key.
    const pool = fakePool([[{ execution_key: 'k' }]]);
    const store = new PostgresReceiptStore(pool as unknown as Pool);

    assert.equal(await store.reserve('k', receipt()), undefined);
    assert.equal(pool.queries.length, 1, 'one statement: SELECT-then-INSERT would race');
    assert.match(pool.queries[0].sql, /INSERT INTO action_receipts/);
    assert.match(pool.queries[0].sql, /ON CONFLICT \(execution_key\) DO NOTHING/);
    assert.equal(pool.queries[0].params?.[0], 'k');
  });

  test('losing the race returns the winner’s receipt instead of executing', async () => {
    const held = receipt({ actor: 'user:winner', state: 'completed' });
    // No row from the INSERT (conflict), then the existing row from the SELECT.
    const pool = fakePool([[], [{ receipt: held }]]);
    const store = new PostgresReceiptStore(pool as unknown as Pool);

    const result = await store.reserve('k', receipt({ actor: 'user:loser' }));

    assert.deepEqual(result, held);
    assert.match(pool.queries[1].sql, /SELECT receipt FROM action_receipts/);
  });

  test('find returns undefined for a key that has never been claimed', async () => {
    const pool = fakePool([[]]);
    const store = new PostgresReceiptStore(pool as unknown as Pool);

    assert.equal(await store.find('never-seen'), undefined);
  });

  test('complete updates the row it reserved, and inserts nothing new', async () => {
    const pool = fakePool([[]]);
    const store = new PostgresReceiptStore(pool as unknown as Pool);

    await store.complete('k', receipt({ state: 'completed' }));

    assert.match(pool.queries[0].sql, /UPDATE action_receipts SET receipt = \$2/);
    assert.match(pool.queries[0].sql, /WHERE execution_key = \$1/);
  });
});
