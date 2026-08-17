import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleEmailProvider } from '../src/providers/console-email.provider';
import { ProviderRegistry } from '../src/providers/provider-registry';
import { runProviderContract } from './provider-contract';

// Every adapter runs the shared contract. A second email provider adds four
// lines here and no new rules.
runProviderContract('console-email', {
  provider: () => new ConsoleEmailProvider(),
  capability: 'email.send',
  valid: { to: 'someone@example.com', subject: 'Item 1', body: 'hello' },
  malformed: [
    null,
    'a string',
    { to: 'not-an-address', subject: 's', body: 'b' },
    { to: 'someone@example.com', subject: '', body: 'b' },
    { to: 'someone@example.com', subject: 's' },
  ],
});

describe('ProviderRegistry', () => {
  test('resolves a capability to an adapter, not the other way round', () => {
    const registry = new ProviderRegistry([new ConsoleEmailProvider()]);
    assert.equal(registry.select('email.send')?.id, 'console-email');
    assert.deepEqual(registry.capabilities(), ['email.send']);
  });

  test('returns nothing for a capability no adapter offers', () => {
    const registry = new ProviderRegistry([new ConsoleEmailProvider()]);
    assert.equal(registry.select('payment.charge'), undefined);
  });

  test('honours a preferred adapter, and refuses to substitute another', () => {
    const registry = new ProviderRegistry([new ConsoleEmailProvider()]);
    assert.equal(registry.select('email.send', 'console-email')?.id, 'console-email');
    // Selecting an adapter that is not registered must fail closed rather than
    // quietly send through a different one.
    assert.equal(registry.select('email.send', 'ses'), undefined);
  });

  test('refuses two adapters with the same id', () => {
    assert.throws(
      () => new ProviderRegistry([new ConsoleEmailProvider(), new ConsoleEmailProvider()]),
      /duplicate provider id/,
    );
  });
});
