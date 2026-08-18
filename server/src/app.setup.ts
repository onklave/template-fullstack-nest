import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiExceptionFilter } from './api-exception.filter';

/**
 * Everything that turns a bare Nest application into THIS service's HTTP
 * surface: the /api prefix, the body limit, the error filter, the fingerprint
 * removal.
 *
 * It lives here rather than inline in main.ts for one reason: the governance
 * e2e tests (test/governance.e2e.test.ts) must exercise the same surface the
 * platform serves. Importing main.ts would boot the process; importing this
 * cannot. If a rule is added to the request pipeline, add it here or the tests
 * will be asserting against a different application than the one that ships.
 */
export function configureApp(app: NestExpressApplication): void {
  // Do not advertise the framework: it hands attackers a free fingerprint.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // The app is created with `bodyParser: false` so this 16kb limit replaces
  // (rather than stacks on top of) Nest's default 100kb parser.
  app.useBodyParser('json', { limit: '16kb' });

  // EVERY route lives under /api — including /api/healthz. Onklave routes by
  // path prefix and does NOT strip it, so a request the browser makes to
  // /api/items arrives here as /api/items. Removing this prefix would make
  // every route a 404 in production while working perfectly on localhost.
  app.setGlobalPrefix('api');

  // One filter owns every error response (and reports 5xx to Onklave error
  // tracking via the SDK's OnklaveExceptionFilter) — see api-exception.filter.ts.
  app.useGlobalFilters(new ApiExceptionFilter());
}
