import { Injectable } from '@nestjs/common';

/**
 * Policy and approvals.
 *
 * Policy is a table of capability -> approval mode, and it is DENY BY DEFAULT:
 * a capability that is not in the table cannot be executed at all. The table
 * itself lives in app.module.ts (the ACTION_POLICY provider) so that "what may
 * this app do" is one visible value rather than a rule scattered through
 * controllers, and it must agree with `capabilities` / `approvals` in
 * onklave.yaml.
 */

/** Same two modes the platform manifest uses (`approvals:` in onklave.yaml). */
export type ApprovalMode = 'automatic' | 'required';

/** capability -> approval mode. Anything absent is denied. */
export type PolicyRules = Record<string, ApprovalMode>;

/** Injection token for the rules table (see app.module.ts). */
export const ACTION_POLICY = 'ACTION_POLICY';

/**
 * Records human approvals. An approval is granted for one execution key —
 * action-id + revision + capability — so approving a deployment of revision
 * `abc123` does NOT authorize the same action against `def456`. Code cannot
 * change underneath an approval.
 *
 * In-process and therefore lost on restart, which is fine while approvals are
 * granted and consumed within one request/response. Persist it (and expire
 * entries) before you grant approvals through a separate human workflow —
 * see decisions/ADR-0006-in-process-action-state.md.
 */
@Injectable()
export class ApprovalStore {
  private readonly granted = new Map<string, string>();

  /** Grant an approval for an execution key; returns the approval id. */
  grant(executionKey: string, approvalId: string): void {
    this.granted.set(executionKey, approvalId);
  }

  /** The approval id authorizing this exact execution key, if any. */
  find(executionKey: string): string | undefined {
    return this.granted.get(executionKey);
  }
}
