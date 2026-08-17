import 'reflect-metadata';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ActionReceipt, ActionRequest, ActionResult } from '../src/actions/action.types';
import { ACTION_POLICY, PolicyRules } from '../src/actions/policy';
import { InMemoryReceiptStore, RECEIPT_STORE } from '../src/actions/receipt-store';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PG_POOL } from '../src/db';
import { CapabilityProvider, ProviderValidation } from '../src/providers/capability-provider';
import { ProviderRegistry } from '../src/providers/provider-registry';

/**
 * Governance at the HTTP boundary (Governed App Starter §24).
 *
 * These are deliberately FEW. Almost every governance rule is already asserted
 * provider-independently in action-executor.test.ts, and duplicating it here
 * would buy nothing. What lands here is only what cannot be observed below
 * HTTP:
 *
 *  - the /api prefix, which exists in production and not in a unit test;
 *  - `@Header` freshness declarations, which only take effect over the wire;
 *  - action state -> HTTP status, applied by the controller's `@Res` passthrough;
 *  - a duplicate action across TWO separate requests, not two calls in one
 *    process tick;
 *  - what a response body actually contains, which is where a secret would
 *    leak if one ever did.
 *
 * The whole real AppModule is booted — the same ACTION_POLICY and the same
 * registered providers that ship — with only the edges replaced: the pg pool
 * (no database in CI), the receipt store (its SQL is asserted in
 * receipt-store.test.ts), and a spy adapter so sends can be counted. No HTTP
 * client dependency: Node's fetch against an ephemeral port.
 */

/** Values that must never appear in a response. Fake, but shaped like the real thing. */
const SECRET_DSN = 'postgres://app:pa55w0rd-NEVER-SHIP@db.internal:5432/app';
const SECRET_SMTP = 'smtp://api:key-NEVER-SHIP@smtp.example.com';

interface ItemRow {
  id: string;
  name: string;
  created_at: string;
}

/** Counts what it was asked to send, so "exactly once" is checkable. */
class SpyEmailProvider implements CapabilityProvider {
  readonly id = 'spy-email';
  readonly capabilities = ['email.send'] as const;
  readonly credentialRefs = ['SMTP_URL'] as const;
  readonly sends: ActionRequest[] = [];

  async validate(input: unknown): Promise<ProviderValidation> {
    return input && typeof input === 'object' ? { ok: true } : { ok: false, error: 'expected an object' };
  }

  async execute(request: ActionRequest): Promise<ActionResult> {
    this.sends.push(request);
    return { ok: true, output: { messageId: `spy-${request.actionId}` } };
  }
}

/** Enough of a pg Pool to serve the items routes, with an optional fault. */
function itemsPool(seed: ItemRow[], failOn?: RegExp) {
  const rows = [...seed];
  return {
    async query(sql: string, params?: unknown[]) {
      if (failOn?.test(sql)) {
        // What a real pg failure looks like: the connection string is in the
        // message. If the filter ever echoed it, the sweep below would catch it.
        throw new Error(`connection to ${SECRET_DSN} failed`);
      }
      if (/FROM items WHERE id/.test(sql)) {
        return { rows: rows.filter((r) => r.id === String(params?.[0])) };
      }
      if (/INSERT INTO items/.test(sql)) {
        const row: ItemRow = {
          id: String(rows.length + 1),
          name: String(params?.[0]),
          created_at: '2026-08-17T00:00:00.000Z',
        };
        rows.push(row);
        return { rows: [row] };
      }
      return { rows };
    },
    async end() {
      /* nothing to drain */
    },
  };
}

const ITEM: ItemRow = { id: '1', name: 'Invoice 42', created_at: '2026-08-17T00:00:00.000Z' };

const started: INestApplication[] = [];

/**
 * Boot the real application on an ephemeral port. `policy` overrides the
 * shipped ACTION_POLICY so a refusal can be observed at the API; everything
 * else — routes, filter, prefix, executor — is what production runs.
 */
async function start(options: { policy?: PolicyRules; failOn?: RegExp } = {}) {
  const provider = new SpyEmailProvider();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL)
    .useValue(itemsPool([ITEM], options.failOn))
    .overrideProvider(RECEIPT_STORE)
    .useValue(new InMemoryReceiptStore())
    .overrideProvider(ProviderRegistry)
    .useValue(new ProviderRegistry([provider]));
  if (options.policy) {
    builder = builder.overrideProvider(ACTION_POLICY).useValue(options.policy);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  // The SAME configuration main.ts applies. If these drifted apart, every
  // assertion below would be about an application that does not ship.
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  started.push(app);

  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, provider, url: `http://127.0.0.1:${port}` };
}

after(async () => {
  await Promise.all(started.map((app) => app.close()));
});

const notify = (url: string, actionId: string) =>
  fetch(`${url}/api/items/1/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actionId, to: 'someone@example.com' }),
  });

/** The response body of a governed action is always a receipt. */
const receiptOf = (res: Response): Promise<ActionReceipt> => res.json() as Promise<ActionReceipt>;

describe('the /api prefix is real, not a convention', () => {
  test('routes answer under /api and 404 without it', async () => {
    const { url } = await start();

    // The single easiest thing to get wrong here: an API mounted at / works
    // on localhost and 404s on everything in production, probe included.
    assert.equal((await fetch(`${url}/api/healthz`)).status, 200);
    assert.equal((await fetch(`${url}/healthz`)).status, 404);
    assert.equal((await fetch(`${url}/items`)).status, 404);
  });
});

describe('freshness classes reach the wire', () => {
  test('a display read may be cached briefly; a live read may not be cached at all', async () => {
    const { url } = await start();

    // @Header only takes effect over HTTP, so this cannot be asserted by
    // calling the controller method directly.
    const list = await fetch(`${url}/api/items`);
    assert.equal(list.headers.get('cache-control'), 'private, max-age=5');

    const one = await fetch(`${url}/api/items/1`);
    assert.equal(one.headers.get('cache-control'), 'no-store');
  });
});

describe('an unauthorised capability is refused at the API', () => {
  test('a capability absent from the policy cannot be reached through a route', async () => {
    // The route is unchanged and the adapter is registered and willing. Only
    // the policy is empty — and that alone must stop it.
    const { url, provider } = await start({ policy: {} });

    const res = await notify(url, 'denied-1');
    const receipt = await receiptOf(res);

    assert.equal(res.status, 422);
    assert.equal(receipt.state, 'failed');
    assert.match(receipt.error!, /not permitted by this app's policy/);
    assert.equal(provider.sends.length, 0, 'nothing may execute on a denied capability');
  });

  test('an approval-required capability answers 202 and executes nothing', async () => {
    const { url, provider } = await start({ policy: { 'email.send': 'required' } });

    const res = await notify(url, 'unapproved-1');
    const receipt = await receiptOf(res);

    assert.equal(res.status, 202, '202 means accepted-not-done; only 200 means done');
    assert.equal(receipt.state, 'awaiting_approval');
    assert.equal(provider.sends.length, 0);
  });
});

describe('a duplicate action does not execute twice', () => {
  test('two identical requests return one receipt and cause one side effect', async () => {
    const { url, provider } = await start();

    const first = await notify(url, 'notify-1');
    const second = await notify(url, 'notify-1');
    const [a, b] = [await receiptOf(first), await receiptOf(second)];

    assert.equal(first.status, 200);
    assert.equal(a.state, 'completed');
    // Same receipt, not merely an equivalent one: the retry was answered from
    // the store, so `completedAt` is the first attempt's.
    assert.deepEqual(b, a);
    assert.equal(second.status, 200);
    assert.equal(provider.sends.length, 1, 'a retried click must not send twice');
  });

  test('a different actionId is a different action', async () => {
    const { url, provider } = await start();

    await notify(url, 'notify-a');
    await notify(url, 'notify-b');

    assert.equal(provider.sends.length, 2);
  });
});

describe('no secret reaches an HTTP response', () => {
  test('not in a receipt, a read, an error body or a header', async () => {
    process.env['DATABASE_URL'] = SECRET_DSN;
    process.env['SMTP_URL'] = SECRET_SMTP;
    // No ingest key configured: /api/onklave/config must 404 rather than
    // inventing something to serve.
    delete process.env['ONKLAVE_ERRORS_INGEST_KEY'];
    const { url } = await start();

    const responses = [
      await fetch(`${url}/api/items`),
      await fetch(`${url}/api/items/1`),
      await fetch(`${url}/api/onklave/config`),
      await fetch(`${url}/api/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'a thing' }),
      }),
      await notify(url, 'secret-sweep-1'),
    ];

    assert.equal(responses[2].status, 404, 'no key configured => nothing served');

    for (const res of responses) {
      const seen = (await res.text()) + JSON.stringify([...res.headers]);
      for (const secret of [SECRET_DSN, SECRET_SMTP, 'pa55w0rd-NEVER-SHIP', 'key-NEVER-SHIP']) {
        assert.equal(seen.includes(secret), false, `${res.url} leaked a credential`);
      }
    }

    delete process.env['DATABASE_URL'];
    delete process.env['SMTP_URL'];
  });

  test('a store failure answers 500 with nothing in it', async () => {
    const { url } = await start({ failOn: /FROM items/ });
    // The filter logs the real exception server-side on purpose; silence it so
    // the assertion, not the noise, is what this test shows.
    const logged = console.error;
    console.error = () => undefined;
    try {
      const res = await fetch(`${url}/api/items`);
      const body = await res.text();

      assert.equal(res.status, 500);
      // Not "mostly redacted" — the 500 body is a constant. A failed query
      // would otherwise echo SQL, and a failed connection the credential.
      assert.equal(body, '{"error":"Internal Server Error"}');
    } finally {
      console.error = logged;
    }
  });
});
