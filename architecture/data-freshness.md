# Data freshness

Every read in this app belongs to one of four classes. The class decides
whether the value may come from a cache — and, crucially, whether it may be
used to authorize something.

| Class | Meaning | Caching | Here |
|---|---|---|---|
| `static` | Shell, branding, docs | Aggressively cacheable | The Angular bundle |
| `display` | Lists, dashboards, summaries | A cached projection is fine | `GET /api/items` — `Cache-Control: private, max-age=5` |
| `live` | Current state of one thing | Refresh on interaction | `GET /api/items/:id` — `Cache-Control: no-store` |
| `transactional` | The input to a side effect | **Never cached. Re-read from the authority immediately before executing** | The item behind `POST /api/items/:id/notify` |

The same declaration lives in `onklave.yaml` under `freshness:`.

## The rule that matters

> A cached value must never be the evidence that a sensitive operation is still
> valid.

A dashboard says the item exists and is called "Invoice 42". By the time the
user clicks, it may have been renamed or deleted. So the executor does not
trust the client's copy — it does not even trust the value the request carried.

## How it is enforced, not just documented

`ActionExecutor.execute()` takes the re-check as a **required argument**:

```ts
const receipt = await this.actions.execute(
  { actionId, capability: 'email.send', actor, input: { to } },
  async () => {
    const item = await this.items.get(id);   // PostgreSQL — the authority
    return item ? { to, subject: `Item ${item.id}`, body: … } : null;
  },
);
```

- It runs **after** policy and approval and **immediately before** execute, so
  nothing can go stale in between.
- Its return value is what the provider executes. `request.input` is only what
  the client believed; the executor replaces it.
- `null` means the world moved — the row is gone, the amount changed, the
  target is no longer valid — and the action fails having done nothing.

There is no overload without the re-check, and no way to pass `() => input`
honestly: the callback must read the authority. Reviewers should reject one
that does not.

Tested in `server/test/action-executor.test.ts`:
"executes the value read from the authority, not the one the client sent" and
"stale state stops execution: nothing runs when the target is gone".

## Client state

The Angular signals in `client/src/app/app.ts` are a **projection** of server
truth: the server acts, returns the new authoritative value, and the projection
is refreshed from it. The client never computes a value the server should own,
and never treats "the request succeeded" as anything other than what the
response body says.

## When you add a read

1. Decide the class before writing the handler.
2. Add it to `freshness:` in `onklave.yaml` if it is a new data class.
3. Set the matching `Cache-Control` header.
4. If it will ever be an input to a side effect, it is `transactional`, and it
   is read inside the re-check callback — not before it.
