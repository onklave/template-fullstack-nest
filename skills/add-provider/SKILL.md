---
name: add-provider
description: Integrate an external system (email, payments, storage, a SaaS API) as a capability adapter.
---

# Add a provider

Read `architecture/providers.md` first, then `architecture/actions.md` if this
capability is new. Work the eleven steps in order — this is a procedure, not a
judgement call. **Class C at minimum** (see `AGENTS.md` §10); Class D if the
capability is destructive, financial or credential-bearing.

Worked example throughout: *"add a second email provider and make it selectable
per organisation."*

---

### 1. Identify the capability

Name the *operation*, not the vendor: `email.send`, `payment.charge`,
`storage.write`. Lowercase, dot-separated — a colon is rejected by the platform
manifest.

Is it already declared? Check `capabilities:` in `onklave.yaml` and
`ACTION_POLICY` in `server/src/app.module.ts`. A second email provider needs
**no new capability**: it serves the existing `email.send`. A new capability is
a bigger change — do steps 10 and 11 properly.

### 2. Inspect the existing providers

`server/src/providers/console-email.provider.ts` is the reference
implementation and is short on purpose. Copy its shape: the id, the
`capabilities` and `credentialRefs` arrays, `validate()` returning a reason
rather than throwing, `execute()` returning a normalized `ActionResult`.

### 3. Define the provider's configuration

What does the adapter need to exist? An API base URL, a region, a from-address.
Configuration is **not** secret: read it from `process.env` with a sane default
and fail clearly when a required one is missing. Keep it to the minimum — an
adapter with eight knobs is a service, not an adapter.

### 4. Define the capability mapping

Which capabilities does it serve, and with what input? The input shape is the
capability's, not the vendor's: `email.send` takes `{ to, subject, body }`
whether SMTP, SES or Postmark is behind it. If a vendor needs something extra,
map it inside the adapter — do not push a vendor field into the capability.

### 5. Implement the adapter

New file, `server/src/providers/<name>.provider.ts`, implementing
`CapabilityProvider`. No imports from `items/`, controllers or policy. No
retries that could duplicate a side effect (the executor owns idempotency). No
logging of the payload or of a credential.

### 6. Add the secret references

List the environment-variable **names** in `credentialRefs`, read them at
execute time via `credential('SMTP_URL')`, and declare each one in the `api`
service's `env:` block in `onklave.yaml`:

```yaml
      - name: SMTP_URL
        required: true
        secret: true
```

The *value* is stored per project and environment in the Onklave vault and
injected at boot by `injectOnklaveSecrets()`. Never put a value in the repo, a
test, a comment or a log line. `required: true` makes a missing secret block the
deploy instead of failing on the first send.

### 7. Add (or keep) the mock provider

Every capability keeps a safe development adapter. `email.send` already has
`ConsoleEmailProvider` — **keep it**; the real adapter is registered alongside
it and selected, never swapped in by deletion. A genuinely new capability needs
a new mock in the same commit as its first real adapter, so the app can still be
built and tested without production credentials.

### 8. Add contract tests

`server/test/providers.test.ts`:

```ts
runProviderContract('<name>', {
  provider: () => new YourProvider(),
  capability: 'email.send',
  valid: { to: 'someone@example.com', subject: 's', body: 'b' },
  malformed: [null, 'a string', { to: 'not-an-address', subject: 's', body: 'b' }],
});
```

The shared suite (`server/test/provider-contract.ts`) covers the rules that
apply to every adapter. Add adapter-specific tests only for behaviour the
contract cannot know about. Do not weaken the contract to make an adapter pass.

### 9. Document the external side effects

In the adapter's file header, in plain words: what it does out in the world,
whether it is reversible, what it costs, what it rate-limits, and what happens
on a partial failure. Someone approving this later reads that header.

If it changes how the app is reasoned about, add or update the relevant
`architecture/` document too.

### 10. Define the default policy

For an existing capability, nothing changes — the policy is on the capability,
not the adapter.

For a new one, add it in **both** places, and they must agree:

```yaml
# onklave.yaml
capabilities:
  - storage.write
```

```ts
// server/src/app.module.ts
const POLICY: PolicyRules = { 'email.send': 'automatic', 'storage.write': 'required' };
```

Default to `required` for anything destructive, financial or irreversible.
`automatic` is a decision, not the absence of one.

### 11. Request approval for a new privileged capability

Adding a capability widens what this application is allowed to do. Say so
explicitly in the PR description: the capability, the adapter, the credentials
it needs, the side effects, the default policy, and why that policy. Do not
merge a new privileged capability on your own authority.

---

## Making it selectable per organisation

`ProviderRegistry.select(capability, preferredId?)` is the only seam. Register
both adapters:

```ts
const PROVIDERS = [new ConsoleEmailProvider(), new SesEmailProvider()];
```

then resolve the preference where the action is created (in the controller,
from the organisation's settings row or a per-environment variable) and pass it
through. Do not branch on a provider id anywhere else, do not read the
organisation inside an adapter, and do not let the *client* choose the adapter —
that is a policy decision, and it is made server-side.

`select()` with an unknown id returns nothing and the action fails closed
rather than sending through a different provider.

## Before you call it done

```bash
cd server && npm run lint && npm test && npm run build
```

and confirm:

- [ ] no credential **value** anywhere in the diff, the tests or the logs;
- [ ] the mock is still registered;
- [ ] `onklave.yaml` (`capabilities`, `approvals`, the `api` service's `env`)
      and `ACTION_POLICY` agree;
- [ ] `architecture/providers.md` still describes reality — if selection is now
      per organisation, say where the preference is resolved;
- [ ] the PR description names the capability class (C or D), the side effects
      and the default policy.
