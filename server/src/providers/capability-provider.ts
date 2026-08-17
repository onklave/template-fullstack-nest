import { ActionRequest, ActionResult } from '../actions/action.types';

/** The answer to "is this input executable?" — never a thrown exception. */
export interface ProviderValidation {
  ok: boolean;
  /** Client-safe reason when `ok` is false. */
  error?: string;
}

/**
 * A capability adapter. One implementation per external system; the
 * application asks for `email.send` and gets whichever adapter the registry
 * selects, so swapping SMTP for SES changes no application code.
 *
 * Implementations MUST:
 *  - be constructible with no arguments and no I/O (registration is cheap);
 *  - read credentials from `process.env` at execute time, by the names in
 *    `credentialRefs`, and never from a constant, a config file or a request;
 *  - return normalized `ActionResult`s instead of throwing for expected
 *    failures (a rejected card, a bad address);
 *  - keep credentials out of `output` and out of `error`.
 *
 * Adding one is a procedure, not a judgement call: skills/add-provider/SKILL.md.
 */
export interface CapabilityProvider {
  /** Stable adapter id, e.g. `console-email`. Appears on every receipt. */
  readonly id: string;

  /** Capabilities this adapter offers, e.g. `['email.send']`. */
  readonly capabilities: readonly string[];

  /**
   * The environment-variable NAMES this adapter's credentials arrive under —
   * `['SMTP_URL']`, not the value. The platform's vault injects the values
   * into `process.env` at startup (`injectOnklaveSecrets()` in src/onklave.ts),
   * so the repository only ever contains the reference. Declare the names here
   * and in `env:` in onklave.yaml so a missing secret blocks the deploy instead
   * of failing at the first send.
   */
  readonly credentialRefs: readonly string[];

  /** Shape/precondition check on the authoritative input. Must not throw. */
  validate(input: unknown): Promise<ProviderValidation>;

  /** Perform the side effect. Only ever called by ActionExecutor. */
  execute(request: ActionRequest): Promise<ActionResult>;
}

/**
 * Read a declared credential at execute time. Returns undefined when the
 * secret is not present (local development, or a provider being exercised by
 * the contract tests) so the adapter can degrade instead of crashing.
 */
export function credential(ref: string): string | undefined {
  return process.env[ref];
}
