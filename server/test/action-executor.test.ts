import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionExecutor } from '../src/actions/action-executor';
import { ActionRequest, ActionResult } from '../src/actions/action.types';
import { ApprovalStore, PolicyRules } from '../src/actions/policy';
import { InMemoryReceiptStore } from '../src/actions/receipt-store';
import { CapabilityProvider, ProviderValidation } from '../src/providers/capability-provider';
import { ProviderRegistry } from '../src/providers/provider-registry';

/**
 * The governance tests. These assert the rules ActionExecutor enforces for
 * EVERY capability, so they hold for providers that do not exist yet:
 * unauthorised capability rejected, approval not bypassable, an approval
 * bound to one revision, no duplicate side effect, stale state stops
 * execution, a hung provider fails instead of hanging, and every attempt
 * leaves an audit record.
 */

/** Records what it was asked to do; optionally hangs or fails. */
class SpyProvider implements CapabilityProvider {
  readonly id = 'spy';
  readonly capabilities = ['email.send', 'deploy.production'] as const;
  readonly credentialRefs = [] as const;
  readonly calls: ActionRequest[] = [];

  constructor(private readonly behaviour: 'ok' | 'hang' | 'fail' = 'ok') {}

  async validate(input: unknown): Promise<ProviderValidation> {
    return input && typeof input === 'object'
      ? { ok: true }
      : { ok: false, error: 'expected an object' };
  }

  async execute(request: ActionRequest): Promise<ActionResult> {
    this.calls.push(request);
    if (this.behaviour === 'hang') {
      return new Promise<ActionResult>(() => undefined);
    }
    if (this.behaviour === 'fail') {
      return { ok: false, error: 'upstream refused' };
    }
    return { ok: true, output: { echoed: request.input } };
  }
}

const POLICY: PolicyRules = { 'email.send': 'automatic', 'deploy.production': 'required' };

function build(policy: PolicyRules = POLICY, provider = new SpyProvider()) {
  const approvals = new ApprovalStore();
  const executor = new ActionExecutor(
    policy,
    new ProviderRegistry([provider]),
    approvals,
    new InMemoryReceiptStore(),
  );
  return { executor, provider, approvals };
}

const request = (over: Partial<ActionRequest> = {}): ActionRequest => ({
  actionId: 'act-1',
  capability: 'email.send',
  actor: 'user:1',
  input: { to: 'client@example.com' },
  ...over,
});

/** The authority says the input is this. */
const authoritative = async () => ({ to: 'authoritative@example.com' });

afterEach(() => {
  delete process.env['ONKLAVE_COMMIT_SHA'];
  delete process.env['ACTION_TIMEOUT_MS'];
});

describe('policy', () => {
  test('a capability the app has not declared cannot execute', async () => {
    const { executor, provider } = build();

    const bad = request({ capability: 'payment.charge' });
    const receipt = await executor.execute(bad, authoritative);

    assert.equal(receipt.state, 'failed');
    assert.match(receipt.error!, /not permitted by this app's policy/);
    assert.equal(provider.calls.length, 0);
  });

  test('a declared capability with no adapter fails instead of guessing', async () => {
    const registry = new ProviderRegistry([]);
    const executor = new ActionExecutor(
      POLICY,
      registry,
      new ApprovalStore(),
      new InMemoryReceiptStore(),
    );

    const receipt = await executor.execute(request(), authoritative);

    assert.equal(receipt.state, 'failed');
    assert.match(receipt.error!, /no provider offers capability/);
  });
});

describe('approval', () => {
  test('an approval-required action cannot bypass approval', async () => {
    const { executor, provider } = build();

    const receipt = await executor.execute(
      request({ capability: 'deploy.production' }),
      authoritative,
    );

    assert.equal(receipt.state, 'awaiting_approval');
    assert.equal(provider.calls.length, 0);
  });

  test('an approval authorizes exactly one action-id + revision + capability', async () => {
    process.env['ONKLAVE_COMMIT_SHA'] = 'abc123';
    const { executor, provider, approvals } = build();
    approvals.grant('act-1:abc123:deploy.production', 'apr_01');

    const approved = await executor.execute(
      request({ capability: 'deploy.production' }),
      authoritative,
    );
    assert.equal(approved.state, 'completed');
    assert.equal(approved.approval, 'apr_01');

    // Same approval, different revision: the code changed underneath it.
    process.env['ONKLAVE_COMMIT_SHA'] = 'def456';
    const later = await executor.execute(
      request({ capability: 'deploy.production' }),
      authoritative,
    );
    assert.equal(later.state, 'awaiting_approval');
    assert.equal(provider.calls.length, 1);
  });
});

describe('the authoritative re-check', () => {
  test('executes the value read from the authority, not the one the client sent', async () => {
    const { executor, provider } = build();

    const receipt = await executor.execute(request(), authoritative);

    assert.equal(receipt.state, 'completed');
    assert.deepEqual(provider.calls[0].input, { to: 'authoritative@example.com' });
  });

  test('stale state stops execution: nothing runs when the target is gone', async () => {
    const { executor, provider } = build();

    const receipt = await executor.execute(request(), async () => null);

    assert.equal(receipt.state, 'failed');
    assert.match(receipt.error!, /changed since this action was prepared/);
    assert.equal(provider.calls.length, 0);
  });

  test('the provider still validates what the authority returned', async () => {
    const { executor, provider } = build();

    const receipt = await executor.execute(request(), async () => 'not an object');

    assert.equal(receipt.state, 'failed');
    assert.equal(receipt.error, 'expected an object');
    assert.equal(provider.calls.length, 0);
  });
});

describe('idempotency', () => {
  test('the same action-id + revision + capability executes once', async () => {
    const { executor, provider } = build();

    const first = await executor.execute(request(), authoritative);
    const second = await executor.execute(request(), authoritative);

    assert.equal(provider.calls.length, 1);
    assert.deepEqual(second, first);
  });

  test('a new revision is a new action', async () => {
    process.env['ONKLAVE_COMMIT_SHA'] = 'abc123';
    const { executor, provider } = build();
    await executor.execute(request(), authoritative);

    process.env['ONKLAVE_COMMIT_SHA'] = 'def456';
    await executor.execute(request(), authoritative);

    assert.equal(provider.calls.length, 2);
  });
});

describe('failure handling', () => {
  test('a hung provider fails the action rather than holding the request open', async () => {
    process.env['ACTION_TIMEOUT_MS'] = '20';
    const { executor } = build(POLICY, new SpyProvider('hang'));

    const receipt = await executor.execute(request(), authoritative);

    assert.equal(receipt.state, 'failed');
    assert.equal(receipt.error, 'the provider call failed');
  });

  test('a provider that reports failure is a failed action, not a successful one', async () => {
    const { executor } = build(POLICY, new SpyProvider('fail'));

    const receipt = await executor.execute(request(), authoritative);

    assert.equal(receipt.state, 'failed');
    assert.equal(receipt.error, 'upstream refused');
    assert.equal(receipt.output, undefined);
  });
});

describe('the receipt', () => {
  test('records identity, capability, policy, revision and adapter', async () => {
    process.env['ONKLAVE_COMMIT_SHA'] = 'abc123';
    const { executor } = build();

    const receipt = await executor.execute(request(), authoritative);

    assert.equal(receipt.actionId, 'act-1');
    assert.equal(receipt.capability, 'email.send');
    assert.equal(receipt.actor, 'user:1');
    assert.equal(receipt.revision, 'abc123');
    assert.equal(receipt.policy, 'automatic');
    assert.equal(receipt.provider, 'spy');
    assert.equal(receipt.state, 'completed');
    assert.ok(receipt.startedAt && receipt.completedAt);
  });

  test('audits every attempt on one line, without the payload', async () => {
    const { executor } = build();
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => void lines.push(line);
    try {
      await executor.execute(request(), authoritative);
    } finally {
      console.log = log;
    }

    const audit = lines.map((l) => JSON.parse(l)).find((l) => l.audit === 'action');
    assert.ok(audit, 'a governed execution must leave an audit record');
    assert.equal(audit.capability, 'email.send');
    assert.equal(audit.state, 'completed');
    // The audit line is metadata: no input, no output, no credential.
    assert.equal(audit.output, undefined);
  });
});
