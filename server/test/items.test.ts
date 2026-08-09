import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { requireDatabaseUrl } from '../src/db';
import { ItemsService } from '../src/items/items.service';

/**
 * In-memory stand-in for the pg Pool. The service tests assert SQL and row
 * mapping, so they must not need a live database to run — the seam is the
 * PG_POOL provider in app.module.ts.
 */
function fakePool(rows: Array<Record<string, unknown>> = []) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    queries,
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      return { rows };
    },
    async end() {
      /* nothing to drain */
    },
  };
  return pool;
}

describe('ItemsService.list', () => {
  test('maps rows to the wire shape: string id, ISO createdAt, newest first', async () => {
    // node-postgres returns BIGINT ids as strings and TIMESTAMPTZ as Date.
    const pool = fakePool([{ id: '2', name: 'second', created_at: new Date(0) }]);
    const service = new ItemsService(pool as unknown as Pool);

    const items = await service.list();

    assert.deepEqual(items, [
      { id: '2', name: 'second', createdAt: '1970-01-01T00:00:00.000Z' },
    ]);
    // Ids must stay strings on the wire: a BIGINT can exceed 2^53, so parsing
    // it to a number would silently lose precision.
    assert.equal(typeof items[0].id, 'string');
    assert.match(pool.queries[0].sql, /ORDER BY id DESC LIMIT 100/);
  });
});

describe('ItemsService.create', () => {
  test('parameterises the name and returns the persisted row', async () => {
    const pool = fakePool([{ id: 1, name: 'a thing', created_at: '2026-08-09T00:00:00.000Z' }]);
    const service = new ItemsService(pool as unknown as Pool);

    const item = await service.create('a thing');

    assert.deepEqual(item, {
      id: '1',
      name: 'a thing',
      createdAt: '2026-08-09T00:00:00.000Z',
    });
    // The name travels as a bind parameter, never interpolated into SQL.
    assert.deepEqual(pool.queries[0].params, ['a thing']);
    assert.ok(!pool.queries[0].sql.includes('a thing'));
  });
});

describe('ItemsService.ensureSchema', () => {
  test('asserts the items table without dropping anything', async () => {
    const pool = fakePool();
    await new ItemsService(pool as unknown as Pool).ensureSchema();
    assert.match(pool.queries[0].sql, /CREATE TABLE IF NOT EXISTS items/);
  });
});

describe('requireDatabaseUrl', () => {
  test('returns the value when set', () => {
    assert.equal(requireDatabaseUrl({ DATABASE_URL: 'postgres://u:p@h/db' }), 'postgres://u:p@h/db');
  });

  test('throws rather than falling back to in-memory storage when absent', () => {
    assert.throws(() => requireDatabaseUrl({}), /DATABASE_URL is not set/);
  });
});
