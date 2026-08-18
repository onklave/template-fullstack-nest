// The vocabulary of a governed action. Read this file first: every other file
// in src/actions/ and src/providers/ is written in these terms.
//
// See architecture/actions.md for the lifecycle these types describe.

/**
 * Explicit action states. A client MUST read the state off the receipt rather
 * than inferring success from an HTTP status or from having navigated
 * somewhere. `completed` is the only success state.
 */
export type ActionState =
  | 'awaiting_approval'
  | 'executing'
  | 'completed'
  | 'failed';

/** What the caller is asking for. Note: a CAPABILITY, never a provider id. */
export interface ActionRequest {
  /**
   * Caller-supplied identifier for this attempt. With the repository revision
   * and the capability it forms the execution key, so a retried browser
   * request cannot send a second email or take a second payment.
   */
  actionId: string;
  /** e.g. `email.send`. Must be declared in ACTION_POLICY (app.module.ts). */
  capability: string;
  /** Who is asking: `user:<id>` or `agent:<name>`. Recorded on the receipt. */
  actor: string;
  /**
   * The PROPOSED input, as the client sent it. It is never what gets executed:
   * the executor replaces it with the value returned by the re-check, read
   * from the authority immediately before execution. See architecture/data-freshness.md.
   */
  input: unknown;
}

/** What a provider returns. Errors are normalized strings, never stacks. */
export interface ActionResult {
  ok: boolean;
  output?: unknown;
  /** Client-safe reason. Must not contain a credential, host or query. */
  error?: string;
}

/**
 * The record of one governed execution — returned to the caller and written to
 * the log as the app's audit trail.
 */
export interface ActionReceipt {
  actionId: string;
  capability: string;
  actor: string;
  /** Repository revision the action ran against. Approvals are pinned to it. */
  revision: string;
  /** Which policy rule decided this, e.g. `automatic` or `default-deny`. */
  policy: string;
  /** The approval that authorized it, when the policy required one. */
  approval?: string;
  /** Which adapter actually ran. Governance is on the capability, not this. */
  provider?: string;
  state: ActionState;
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

/**
 * Re-reads the authoritative input immediately before execution and returns it,
 * or `null` if the operation is no longer valid (the row was deleted, the
 * amount changed, the target moved). Returning `null` aborts the action.
 *
 * Mandatory — it is a required argument of `ActionExecutor.execute()` precisely
 * so that no caller can skip it.
 */
export type AuthoritativeRecheck = () => Promise<unknown | null>;

/**
 * The repository revision this process is running. The platform injects
 * ONKLAVE_COMMIT_SHA; off-platform it is `dev`.
 */
export function currentRevision(): string {
  return process.env['ONKLAVE_COMMIT_SHA'] || 'dev';
}

/** action-id + revision + capability — the idempotency key. */
export function executionKey(request: ActionRequest, revision: string): string {
  return `${request.actionId}:${revision}:${request.capability}`;
}
