import { Inject, Injectable } from '@nestjs/common';
import { ProviderRegistry } from '../providers/provider-registry';
import { OnklaveErrors } from '../onklave';
import {
  ActionReceipt,
  ActionRequest,
  ActionState,
  AuthoritativeRecheck,
  currentRevision,
  executionKey,
} from './action.types';
import { ACTION_POLICY, ApprovalStore, PolicyRules } from './policy';

/**
 * THE place a privileged or irreversible operation runs. Sending email,
 * charging a card, deleting data, calling an external API: all of it goes
 * through `execute()`, and none of it goes through a controller calling a
 * provider directly.
 *
 * One call carries the whole lifecycle —
 *
 *   idempotency -> policy -> provider -> approval -> AUTHORITATIVE RE-CHECK
 *   -> validate -> execute -> verify -> audit
 *
 * — and returns a receipt (never a bare result), which is both the client's
 * answer and this app's audit record. Detail: architecture/actions.md.
 */
@Injectable()
export class ActionExecutor {
  /**
   * Execution key -> receipt. The key is reserved BEFORE the provider is
   * called, so a double-submitted request gets the in-flight receipt back
   * instead of a second side effect. A failed action is not retryable under
   * the same key by design — retry with a new actionId, which is the correct
   * behaviour for payments and email.
   *
   * In-process: correct for one replica, wrong for several. Move it to a
   * PostgreSQL table with a unique index on the key before scaling `api` up or
   * registering a provider with real side effects — the shape was chosen so
   * that is a substitution, not a rewrite. See
   * decisions/ADR-0006-in-process-action-state.md.
   */
  private readonly receipts = new Map<string, ActionReceipt>();

  /** Wall-clock cap on one provider call, so a hung API cannot hold a request. */
  readonly timeoutMs = Number(process.env['ACTION_TIMEOUT_MS']) || 10_000;

  constructor(
    @Inject(ACTION_POLICY) private readonly policy: PolicyRules,
    private readonly providers: ProviderRegistry,
    private readonly approvals: ApprovalStore,
  ) {}

  async execute(request: ActionRequest, recheck: AuthoritativeRecheck): Promise<ActionReceipt> {
    const revision = currentRevision();
    const key = executionKey(request, revision);

    // Idempotency: action-id + revision + capability. Already seen? Hand back
    // the receipt we already have and execute nothing.
    const seen = this.receipts.get(key);
    if (seen) {
      return seen;
    }

    let receipt: ActionReceipt = {
      actionId: request.actionId,
      capability: request.capability,
      actor: request.actor,
      revision,
      policy: 'default-deny',
      state: 'executing',
      startedAt: new Date().toISOString(),
    };

    // Policy. Deny by default: a capability this app has not declared cannot
    // run, however the request got here.
    const mode = this.policy[request.capability];
    if (!mode) {
      const denied = `capability '${request.capability}' is not permitted by this app's policy`;
      return this.reject(receipt, 'failed', denied);
    }
    receipt = { ...receipt, policy: mode };

    // Capability -> provider. Application code never names an implementation.
    const provider = this.providers.select(request.capability);
    if (!provider) {
      const missing = `no provider offers capability '${request.capability}'`;
      return this.reject(receipt, 'failed', missing);
    }
    receipt = { ...receipt, provider: provider.id };

    // Approval, pinned to this revision, so code cannot change underneath a
    // human's decision. The receipt is NOT cached, so the same action can
    // proceed once approved.
    if (mode === 'required') {
      const approval = this.approvals.find(key);
      if (!approval) {
        const needed = 'human approval is required before this action can execute';
        return this.reject(receipt, 'awaiting_approval', needed);
      }
      receipt = { ...receipt, approval };
    }

    // THE AUTHORITATIVE RE-CHECK. Everything below runs against `authoritative`
    // — read from the store just now — and never against `request.input`, which
    // is only what the client believed when it clicked. `null` means the world
    // moved (row deleted, amount changed) and the action must not run.
    const authoritative = await recheck();
    if (authoritative == null) {
      const stale = 'the target changed since this action was prepared; nothing was executed';
      return this.reject(receipt, 'failed', stale);
    }

    const validation = await provider.validate(authoritative);
    if (!validation.ok) {
      return this.reject(receipt, 'failed', validation.error || 'invalid input');
    }

    // Reserve the key before the side effect happens.
    this.receipts.set(key, receipt);

    try {
      const result = await this.withTimeout(provider.execute({ ...request, input: authoritative }));
      // Verify: a provider that reports failure is a failed action, not a
      // successful one with an error attached.
      return this.finish(key, {
        ...receipt,
        state: result.ok ? 'completed' : 'failed',
        output: result.ok ? result.output : undefined,
        error: result.ok ? undefined : result.error || 'provider reported failure',
      });
    } catch (err) {
      // An adapter that throws or hangs is a bug or an outage — report it.
      // The denials above are deliberate control flow and are deliberately not
      // reported, the same rule api-exception.filter.ts applies to 4xx.
      OnklaveErrors.captureException(err, {
        context: {
          capability: request.capability,
          provider: provider.id,
          actionId: request.actionId,
        },
      });
      return this.finish(key, { ...receipt, state: 'failed', error: 'the provider call failed' });
    }
  }

  /** Fail an action rather than let a provider hold the request open forever. */
  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('provider timed out')), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Refused before anything ran: audited, and deliberately NOT cached. */
  private reject(receipt: ActionReceipt, state: ActionState, error: string): ActionReceipt {
    return this.audit({ ...receipt, state, error });
  }

  /** Terminal receipt: audit it, then store it under the execution key. */
  private finish(key: string, receipt: ActionReceipt): ActionReceipt {
    const done = this.audit(receipt);
    this.receipts.set(key, done);
    return done;
  }

  /**
   * The audit step. One structured line per governed execution — the platform
   * collects stdout, so this is the app's audit trail. It carries no input,
   * output payload or credential: identity, capability, policy and outcome only.
   */
  private audit(receipt: ActionReceipt): ActionReceipt {
    const done: ActionReceipt = { ...receipt, completedAt: new Date().toISOString() };
    const { output: _output, ...record } = done;
    console.log(JSON.stringify({ audit: 'action', ...record }));
    return done;
  }
}

/** HTTP status for an action state. The body always carries the state. */
export const STATUS_FOR_STATE: Record<ActionState, number> = {
  completed: 200,
  awaiting_approval: 202,
  executing: 202,
  failed: 422,
};
