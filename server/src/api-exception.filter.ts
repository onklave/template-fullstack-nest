import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { OnklaveExceptionFilter } from '@onklave/errors/nestjs';
import type { Response } from 'express';

/**
 * The one place that turns exceptions into HTTP responses.
 *
 * It extends the SDK's OnklaveExceptionFilter rather than registering it
 * directly: OnklaveExceptionFilter reports and then RETHROWS, and a global
 * catch-all filter that rethrows escapes Nest's response pipeline entirely —
 * nothing recatches it, and Express's default handler answers with HTML.
 * Subclassing keeps the SDK's capture (with its request context) while this
 * filter owns the response, so the wire shapes stay identical to the Express
 * template:
 *
 *   4xx -> the status plus {"error": "<reason>"}
 *   5xx -> 500 {"error": "Internal Server Error"}
 *
 * Errors are logged server-side only. The 500 body carries no message or
 * stack: a failed query would otherwise echo SQL, and a failed connection
 * would echo the connection string. Only 5xx are reported to Onklave error
 * tracking (a no-op when not initialised) — 4xx are deliberate control flow,
 * not bugs.
 */
@Catch()
export class ApiExceptionFilter extends OnklaveExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      console.error(exception);
      try {
        super.catch(exception, host); // report to Onklave error tracking …
      } catch {
        // … which rethrows by design; the response below is ours to send.
      }
    }

    const res = host.switchToHttp().getResponse<Response>();
    res.status(status).json({ error: messageFor(exception, status) });
  }
}

/** The client-visible reason. Never derived from a non-HTTP (unexpected) error. */
function messageFor(exception: unknown, status: number): string {
  if (status >= 500 || !(exception instanceof HttpException)) {
    return 'Internal Server Error';
  }
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  const error = (body as Record<string, unknown>)['error'];
  return typeof error === 'string' ? error : exception.message;
}
