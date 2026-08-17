import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityProvider } from '../src/providers/capability-provider';

/**
 * The shared provider contract. Every adapter must pass it — a new provider
 * adds one file that calls `runProviderContract(...)` and nothing else, so the
 * rules cannot drift between integrations.
 *
 * These are the checks that belong to a single adapter. The rest of the
 * governance contract is enforced once, for every provider, by ActionExecutor
 * and is tested in action-executor.test.ts: unknown capability rejected,
 * approval not bypassable, idempotency, timeout, stale state, audit record.
 */
export interface ProviderContractCase {
  /** Fresh instance per test — adapters must be cheap to construct. */
  provider: () => CapabilityProvider;
  /** The capability under test. */
  capability: string;
  /** An authoritative input the adapter accepts. */
  valid: unknown;
  /** Inputs it must reject, each with a reason. */
  malformed: unknown[];
}

/** Environment-variable naming: a credential REFERENCE, never a value. */
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function runProviderContract(name: string, testCase: ProviderContractCase): void {
  describe(`provider contract: ${name}`, () => {
    test('declares a stable id and the capability it serves', () => {
      const provider = testCase.provider();
      assert.ok(provider.id.length > 0, 'id must not be empty');
      assert.ok(
        provider.capabilities.includes(testCase.capability),
        `must declare '${testCase.capability}'`,
      );
    });

    test('declares credential REFERENCES, never credential values', () => {
      const provider = testCase.provider();
      for (const ref of provider.credentialRefs) {
        assert.match(
          ref,
          ENV_NAME_PATTERN,
          `credentialRefs must be env var names — got '${ref}'`,
        );
      }
    });

    test('rejects malformed input with a reason, and never throws', async () => {
      const provider = testCase.provider();
      for (const input of testCase.malformed) {
        const result = await provider.validate(input);
        assert.equal(result.ok, false, `should reject ${JSON.stringify(input)}`);
        assert.ok(result.error, 'a rejection must carry a client-safe reason');
      }
    });

    test('accepts the authoritative input', async () => {
      assert.deepEqual(await testCase.provider().validate(testCase.valid), { ok: true });
    });

    test('does not leak a credential into its result', async () => {
      const provider = testCase.provider();
      const sentinel = 'sk_live_SENTINEL_VALUE';
      const saved: Record<string, string | undefined> = {};
      for (const ref of provider.credentialRefs) {
        saved[ref] = process.env[ref];
        process.env[ref] = sentinel;
      }
      try {
        const result = await provider.execute({
          actionId: 'contract-1',
          capability: testCase.capability,
          actor: 'test:contract',
          input: testCase.valid,
        });
        assert.ok(!JSON.stringify(result).includes(sentinel), 'result must not echo a credential');
      } finally {
        for (const ref of provider.credentialRefs) {
          if (saved[ref] === undefined) delete process.env[ref];
          else process.env[ref] = saved[ref];
        }
      }
    });

    test('returns a normalized result rather than throwing', async () => {
      const result = await testCase.provider().execute({
        actionId: 'contract-2',
        capability: testCase.capability,
        actor: 'test:contract',
        input: testCase.valid,
      });
      assert.equal(typeof result.ok, 'boolean');
      if (!result.ok) {
        assert.equal(typeof result.error, 'string');
      }
    });
  });
}
