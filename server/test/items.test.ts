import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { ActionExecutor } from '../src/actions/action-executor';
import { ApprovalStore, PolicyRules } from '../src/actions/policy';
import { InMemoryReceiptStore } from '../src/actions/receipt-store';
import { requireDatabaseUrl } from '../src/db';
import { ItemsController } from '../src/items/items.controller';
import { Item, ItemsService } from '../src/items/items.service';
import { ConsoleEmailProvider } from '../src/providers/console-email.provider';
import { ProviderRegistry } from '../src/providers/provider-registry';

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

describe('ItemsService.get', () => {
  test('reads one row from the authority and maps it, or returns null', async () => {
    const found = fakePool([{ id: '7', name: 'target', created_at: new Date(0) }]);
    assert.deepEqual(await new ItemsService(found as unknown as Pool).get('7'), {
      id: '7',
      name: 'target',
      createdAt: '1970-01-01T00:00:00.000Z',
    });
    assert.deepEqual(found.queries[0].params, ['7']);

    const missing = fakePool([]);
    assert.equal(await new ItemsService(missing as unknown as Pool).get('7'), null);
  });
});

describe('POST /api/items/:id/notify — the governed action', () => {
  const POLICY: PolicyRules = { 'email.send': 'automatic' };

  /** The controller with a stubbed store, wired to the real action boundary. */
  function controller(item: Item | null) {
    const items = { get: async () => item } as unknown as ItemsService;
    const executor = new ActionExecutor(
      POLICY,
      new ProviderRegistry([new ConsoleEmailProvider()]),
      new ApprovalStore(),
      new InMemoryReceiptStore(),
    );
    const res = { status: (code: number) => void statuses.push(code) } as unknown as Response;
    const statuses: number[] = [];
    return { controller: new ItemsController(items, executor), res, statuses };
  }

  const body = { actionId: 'notify-1', to: 'someone@example.com' };

  test('sends the item as the authority holds it, and returns a receipt', async () => {
    const { controller: c, res, statuses } = controller({
      id: '7',
      name: 'committed name',
      createdAt: '2026-08-17T00:00:00.000Z',
    });

    const receipt = await c.notify('7', body, res);

    assert.equal(receipt.state, 'completed');
    assert.equal(receipt.capability, 'email.send');
    assert.equal(receipt.provider, 'console-email');
    assert.deepEqual(statuses, [200]);
  });

  test('refuses to act on an item that no longer exists', async () => {
    const { controller: c, res, statuses } = controller(null);

    const receipt = await c.notify('7', body, res);

    assert.equal(receipt.state, 'failed');
    assert.match(receipt.error!, /changed since this action was prepared/);
    assert.deepEqual(statuses, [422]);
  });

  test('a retried request does not send twice', async () => {
    const { controller: c, res } = controller({
      id: '7',
      name: 'committed name',
      createdAt: '2026-08-17T00:00:00.000Z',
    });

    const first = await c.notify('7', body, res);
    const second = await c.notify('7', body, res);

    assert.deepEqual(second, first);
  });

  test('rejects a request with no idempotency key', async () => {
    const { controller: c, res } = controller(null);
    await assert.rejects(
      () => c.notify('7', { to: 'someone@example.com' }, res),
      (err: unknown) =>
        err instanceof HttpException &&
        err.getStatus() === 400 &&
        /actionId/.test(JSON.stringify(err.getResponse())),
    );
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
