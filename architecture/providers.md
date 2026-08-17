# Providers

Everything this app touches outside itself — mail, payments, storage, a
third-party API — is reached through a **capability adapter** in
`server/src/providers/`.

## Capability, not client

Application code asks for `email.send`. It never writes `new SesClient(...)`,
never branches on which integration is configured, and never sees a credential.

```
controller ─▶ ActionExecutor ─▶ ProviderRegistry.select('email.send') ─▶ adapter
```

This is what makes governance possible: Onklave governs the **capability**, and
the adapter behind it can be replaced without touching policy, tests or
application code. The receipt records which adapter actually ran.

## The interface

`server/src/providers/capability-provider.ts`:

```ts
interface CapabilityProvider {
  readonly id: string;                       // 'console-email' — appears on receipts
  readonly capabilities: readonly string[];  // ['email.send']
  readonly credentialRefs: readonly string[];// ['SMTP_URL'] — NAMES, never values
  validate(input: unknown): Promise<ProviderValidation>;
  execute(request: ActionRequest): Promise<ActionResult>;
}
```

Rules for an implementation:

- constructible with no arguments and no I/O — registration must be cheap;
- read credentials at execute time from `process.env`, by a name in
  `credentialRefs`, never from a constant, a config file or the request;
- return a normalized `ActionResult` for expected failures (a rejected card, a
  bad address) rather than throwing;
- keep credentials out of `output` and out of `error` — both reach the client;
- be a leaf: no imports from `items/`, no controllers, no policy.

## The registry

`ProviderRegistry` maps capability → adapter. Which adapters exist is declared
once, in `server/src/app.module.ts`:

```ts
const PROVIDERS = [new ConsoleEmailProvider()];
```

`select(capability, preferredId?)` is **the seam for choosing between two
adapters** — per organisation, per environment, behind a flag. First registered
wins by default; pass a `preferredId` resolved from whatever selects it. An
unknown `preferredId` returns nothing rather than quietly substituting a
different adapter: fail closed. Do not branch on a provider id anywhere else.

## Credentials

The repository contains **references**, never values:

```
onklave.yaml env:  SMTP_URL (required, secret)
        ↓
Onklave vault (per project, per environment)
        ↓
injectOnklaveSecrets()  in server/src/onklave.ts, at boot
        ↓
process.env['SMTP_URL'] ── read at execute time via credential('SMTP_URL')
```

`injectOnklaveSecrets()` is `@onklave/app-runtime`'s zero-trust startup fetch:
the pod presents its projected Kubernetes ServiceAccount token, vault returns
the `(org, project, environment)` secret map encrypted to an ephemeral key that
only this process holds, and the values land in `process.env`. Off-platform it
is a silent no-op, so local development and CI run unchanged.

An agent may know `SMTP_URL`. It never sees the value, and must never write one
into the repository, a test fixture, or a log line.

Declaring the name in `env:` in `onklave.yaml` with `required: true` makes a
missing secret block the deploy rather than surface as a failed send in
production.

## Mock providers

Every capability keeps a safe development adapter — `ConsoleEmailProvider` for
`email.send`. It talks to nothing, logs what it was asked to do, and returns a
receipt-shaped result. That is what lets the app be built, demonstrated and
tested end to end with no production credentials, and it is what the contract
tests run against in CI.

A real adapter is added **alongside** the mock and selected per environment —
never by deleting the mock.

## Contract tests

`server/test/provider-contract.ts` is the shared suite every adapter must pass:
stable id and declared capability, credential *references* only, malformed
input rejected with a reason and without throwing, the authoritative input
accepted, no credential echoed into the result, normalized results rather than
exceptions.

A new adapter adds four lines to `server/test/providers.test.ts` and no new
rules. The governance rules that apply to all adapters — unauthorised
capability, approval, idempotency, timeout, stale state, audit — are tested
once, provider-independently, in `action-executor.test.ts`.

## Adding one

`skills/add-provider/SKILL.md` — an eleven-step procedure, not a judgement call.
