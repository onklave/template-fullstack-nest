# Actions

Every privileged or irreversible operation runs through
`ActionExecutor.execute()` in `server/src/actions/action-executor.ts`. Nothing
else calls a provider. Read `action.types.ts` first — it is the vocabulary.

## The lifecycle

One call carries all of it:

```
idempotency ─▶ policy ─▶ provider ─▶ approval ─▶ AUTHORITATIVE RE-CHECK
    ─▶ validate ─▶ execute (with timeout) ─▶ verify ─▶ audit ─▶ receipt
```

| Step | What it does | Fails as |
|---|---|---|
| Idempotency | Looks up `action-id + revision + capability`. Seen ⇒ returns the existing receipt and executes nothing. | (returns the earlier receipt) |
| Policy | `ACTION_POLICY` in `app.module.ts`. **Deny by default** — an undeclared capability cannot run. | `failed` |
| Provider | Registry resolves the capability to an adapter. | `failed` |
| Approval | If the policy says `required`, an approval must exist for **this exact execution key**. Not cached, so the action can proceed once approved. | `awaiting_approval` |
| Re-check | The caller's callback re-reads the authority. Its result is what executes. | `failed` |
| Validate | The adapter validates the *authoritative* input. | `failed` |
| Execute | Adapter runs, under a wall-clock timeout (`ACTION_TIMEOUT_MS`, default 10s). | `failed` |
| Verify | An adapter reporting failure is a failed action, not a success with a note. | `failed` |
| Audit | One structured line: identity, capability, policy, revision, outcome. No payload. | — |

## States

`awaiting_approval` · `executing` · `completed` · `failed`

`completed` is the only success state. A client reads the state off the receipt —
it must never infer success from an HTTP status or from having navigated
somewhere. The status only mirrors the state (200 / 202 / 422).

## The receipt

Returned to the caller and logged as this app's audit record:

```json
{
  "actionId": "notify-1",
  "capability": "email.send",
  "actor": "user:42",
  "revision": "a713ec",
  "policy": "automatic",
  "approval": "apr_01…",
  "provider": "console-email",
  "state": "completed",
  "output": { "messageId": "console-notify-1", "to": "someone@example.com" },
  "startedAt": "…",
  "completedAt": "…"
}
```

`state` replaces the spec's `result` field — it is strictly more informative,
and `completed` is the success value. The logged copy drops `output`: audit is
metadata, never payload.

## Idempotency

The execution key is `action-id + revision + capability`, and it is **reserved
before the side effect happens**. So:

- a double-submitted browser request gets the in-flight receipt, not a second
  email;
- a redeploy (new revision) is a new action — deliberately, because the code
  that would run has changed;
- a *failed* action is not retryable under the same key. Retry with a new
  `actionId`. For payments and email that is the correct default: an ambiguous
  failure must not silently re-fire.

The store is in-process. See `decisions/ADR-0006-in-process-action-state.md`
before scaling `api` past one replica.

## Approvals are pinned to a revision

An approval is granted for one execution key, which contains the repository
revision (`ONKLAVE_COMMIT_SHA`). Approving action `X` against `abc123` does not
authorize `X` against `def456`: code cannot change underneath a human's
decision.

## What belongs where

**In the controller:** parse the request envelope (an `actionId`, the caller's
parameters), reject malformed input, build the `ActionRequest`, supply the
re-check, return the receipt. That is all — see `items.controller.ts::notify`.

**In the executor:** everything that makes it safe. Do not reimplement any of
it in a controller, and do not add a second path to a provider.

**In the adapter:** the side effect, and nothing about governance.

## Errors

Failures route through the SDK, never through a bare `console.error` in a
request path:

- an adapter that throws or times out is reported with
  `OnklaveErrors.captureException` — that is a bug or an outage;
- policy denials, missing approvals, stale state and validation failures are
  **not** reported: they are deliberate control flow, the same rule
  `api-exception.filter.ts` applies to 4xx;
- no error message returned to a client may contain a credential, a host, a
  connection string or a query.

## Adding one

`skills/add-sensitive-action/SKILL.md`.
