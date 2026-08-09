import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ArgumentsHost, HttpException, NotFoundException } from '@nestjs/common';
import { ApiExceptionFilter } from '../src/api-exception.filter';

/** Minimal ArgumentsHost + Express response stand-ins. */
function run(exception: unknown): { status: number; body: unknown } {
  const sent = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
    },
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'GET', url: '/api/items' }),
    }),
  } as unknown as ArgumentsHost;

  new ApiExceptionFilter().catch(exception, host);
  return sent;
}

describe('ApiExceptionFilter — the wire contract of the Express template', () => {
  test('a custom-bodied 400 keeps its shape: {"error":"name must be…"}', () => {
    const out = run(new HttpException({ error: 'name must be 1-200 characters' }, 400));
    assert.equal(out.status, 400);
    assert.deepEqual(out.body, { error: 'name must be 1-200 characters' });
  });

  test('an unknown route 404s as {"error":"Not Found"} with no route echo', () => {
    const out = run(new NotFoundException('Cannot GET /api/nope'));
    assert.equal(out.status, 404);
    assert.deepEqual(out.body, { error: 'Not Found' });
  });

  test('a store failure yields a 500 that leaks neither SQL nor the connection string', () => {
    const out = run(
      new Error('connection to server at "10.0.0.5" failed: password authentication failed'),
    );
    assert.equal(out.status, 500);
    assert.deepEqual(out.body, { error: 'Internal Server Error' });
    const text = JSON.stringify(out.body);
    assert.ok(!text.includes('password'));
    assert.ok(!text.includes('10.0.0.5'));
  });
});
