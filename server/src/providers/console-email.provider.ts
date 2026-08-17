import { ActionRequest, ActionResult } from '../actions/action.types';
import { CapabilityProvider, ProviderValidation } from './capability-provider';

/** The authoritative input `email.send` executes. */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

/** Deliberately loose: real addresses are validated by the mail provider. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;

/**
 * The safe development adapter for `email.send`: it writes the message to the
 * log and returns a receipt-shaped result. Nothing leaves the process.
 *
 * Every capability should have one of these, so the app can be built, tested
 * and demonstrated end to end without production credentials — and so the
 * contract tests have something to run against in CI. It is registered by
 * default in app.module.ts; a real adapter (SMTP, SES, Postmark) is added
 * alongside it and selected per environment or per organisation, not by
 * deleting this one.
 */
export class ConsoleEmailProvider implements CapabilityProvider {
  readonly id = 'console-email';
  readonly capabilities = ['email.send'] as const;
  /** None: this adapter talks to nothing. A real one declares e.g. `SMTP_URL`. */
  readonly credentialRefs = [] as const;

  async validate(input: unknown): Promise<ProviderValidation> {
    const msg = input as Partial<EmailMessage> | null;
    if (!msg || typeof msg !== 'object') {
      return { ok: false, error: 'email.send expects an object' };
    }
    if (typeof msg.to !== 'string' || !EMAIL_PATTERN.test(msg.to)) {
      return { ok: false, error: 'to must be an email address' };
    }
    if (typeof msg.subject !== 'string' || !msg.subject || msg.subject.length > MAX_SUBJECT) {
      return { ok: false, error: `subject must be 1-${MAX_SUBJECT} characters` };
    }
    if (typeof msg.body !== 'string' || !msg.body || msg.body.length > MAX_BODY) {
      return { ok: false, error: `body must be 1-${MAX_BODY} characters` };
    }
    return { ok: true };
  }

  async execute(request: ActionRequest): Promise<ActionResult> {
    const msg = request.input as EmailMessage;
    console.log(
      JSON.stringify({
        provider: this.id,
        capability: 'email.send',
        to: msg.to,
        subject: msg.subject,
      }),
    );
    // The output is echoed to the client on the receipt, so it carries an
    // identifier and the recipient — never the body, and never a credential.
    return { ok: true, output: { messageId: `console-${request.actionId}`, to: msg.to } };
  }
}
