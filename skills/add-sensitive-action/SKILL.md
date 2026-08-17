---
name: add-sensitive-action
description: Add an operation with a real side effect — sending, charging, deleting, deploying, calling an external API.
---

# Add a sensitive action

Read `architecture/actions.md` and `architecture/data-freshness.md`.
The reference implementation is `POST /api/items/:id/notify` in
`server/src/items/items.controller.ts` — copy its shape.

**Class C or D** (`AGENTS.md` §10). Say which in the PR description.

## Is it sensitive?

Yes if it is irreversible, costs money, leaves the process, touches a
credential, deletes data, or is visible to someone outside the app. When in
doubt it is sensitive: the cost of routing a harmless operation through the
executor is a few lines.

## Steps

1. **Name the capability** it needs — `email.send`, `storage.write`. If it does
   not exist yet, `skills/add-provider/SKILL.md` first: an action without an
   adapter cannot run.

2. **Decide the approval mode.** `automatic` or `required`, in `ACTION_POLICY`
   (`server/src/app.module.ts`) and mirrored in `onklave.yaml`. Default to
   `required` for anything destructive or financial.

3. **Add the route.** The controller's whole job:

   ```ts
   @Post(':id/<verb>')
   async doIt(@Param('id') id: string, @Body() body: unknown,
              @Res({ passthrough: true }) res: Response): Promise<ActionReceipt> {
     const { actionId, … } = this.readRequest(body);   // envelope validation
     const receipt = await this.actions.execute(
       { actionId, capability: '…', actor: 'user:anonymous', input: { … } },
       async () => { /* re-read the authority; null aborts */ },
     );
     res.status(STATUS_FOR_STATE[receipt.state]);
     return receipt;
   }
   ```

   No provider import, no credential, no policy check of its own, no side
   effect before the executor is called.

4. **Require an idempotency key.** The client sends `actionId`; reject the
   request without one. It is half of what stops a double-click becoming two
   emails.

5. **Write the re-check.** It re-reads the authority (PostgreSQL, or another
   service) and returns the value that will actually be executed. Returning
   `null` aborts. It must not simply return the request's own input — that
   defeats the entire mechanism, and a reviewer should reject it.

6. **Identify the actor.** `user:<sub>` from a verified token when this app has
   authentication, `agent:<name>` for an agent-initiated action, otherwise the
   honest `user:anonymous` (see `architecture/auth.md`).

7. **Return the receipt, not a result.** The client reads `state`; the HTTP
   status only mirrors it. Never return `204` and let the client assume success.

8. **Test the governance, not just the happy path.** Add to
   `server/test/items.test.ts` (or a sibling): the action succeeds and returns a
   receipt; a stale/deleted target fails with nothing executed; a retry with the
   same `actionId` does not execute twice; a request with no `actionId` is
   rejected. The provider-independent rules are already covered by
   `action-executor.test.ts`.

9. **Check what the response and the logs carry.** No credential, no connection
   string, no SQL, no full payload in the audit line.

## Anti-patterns

| Don't | Do |
|---|---|
| Call a provider from a controller or service | Go through `ActionExecutor` |
| Trust the value the client sent | Re-read it in the re-check |
| Add a "just this once" fast path | There is one path |
| Retry inside an adapter | The executor owns idempotency; retry with a new `actionId` |
| Infer success from a 200 | Read `receipt.state` |
| Add a second executor for a special case | Extend the one that exists, or explain in an ADR |
