import { Controller, Get, NotFoundException } from '@nestjs/common';

/**
 * Delivers the browser error-tracking config to the client.
 *
 * The Angular bundle is public, so it cannot ship with a baked-in key; on
 * boot it fetches this endpoint and, on a 200, initialises @onklave/errors
 * browser tracking (see client/src/onklave.ts). The ingest key is
 * rate-limited server-side and safe to expose to this app's own users — it
 * can only submit error events, never read anything back.
 *
 * When no key is configured (local dev, or error tracking not enabled for
 * this environment) the endpoint 404s and the client silently skips
 * initialisation.
 */
@Controller('onklave')
export class OnklaveConfigController {
  @Get('config')
  getConfig(): { errorsIngestKey: string; environment: string | null; release: string | null } {
    const key = process.env['ONKLAVE_ERRORS_INGEST_KEY'];
    if (!key) {
      throw new NotFoundException();
    }
    return {
      errorsIngestKey: key,
      environment: process.env['ONKLAVE_ENV'] || null,
      release: process.env['ONKLAVE_COMMIT_SHA'] || null,
    };
  }
}
