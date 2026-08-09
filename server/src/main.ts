import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiExceptionFilter } from './api-exception.filter';
import { requireDatabaseUrl } from './db';
import { ItemsService } from './items/items.service';
import { initOnklave } from './onklave';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Platform wiring first: per-environment secrets (DATABASE_URL included)
  // land in process.env and error tracking starts. A no-op off-platform
  // (local dev) — nothing below runs differently.
  await initOnklave(process.env['APP_NAME'] || 'template-fullstack-nest-api');

  // Fail fast and loudly if the database is not configured. Starting anyway
  // and degrading to memory would lose every write on the next deploy.
  try {
    requireDatabaseUrl();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  // bodyParser: false so the 16kb JSON limit below replaces (rather than
  // stacks on top of) Nest's default 100kb parser.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Do not advertise the framework: it hands attackers a free fingerprint.
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.useBodyParser('json', { limit: '16kb' });

  // EVERY route lives under /api — including /api/healthz. Onklave routes by
  // path prefix and does NOT strip it, so a request the browser makes to
  // /api/items arrives here as /api/items. Removing this prefix would make
  // every route a 404 in production while working perfectly on localhost.
  app.setGlobalPrefix('api');

  // One filter owns every error response (and reports 5xx to Onklave error
  // tracking via the SDK's OnklaveExceptionFilter) — see api-exception.filter.ts.
  app.useGlobalFilters(new ApiExceptionFilter());

  // SIGTERM/SIGINT -> app.close(): in-flight requests finish and the pg pool
  // drains (ItemsService.onApplicationShutdown) before the process exits.
  app.enableShutdownHooks();

  try {
    await app.get(ItemsService).ensureSchema();
  } catch (err) {
    // Log the reason, never the connection string.
    console.error('failed to reach PostgreSQL or create the schema:', (err as Error).message);
    process.exit(1);
  }

  const port = Number(process.env['PORT']) || 8080;
  await app.listen(port);
  console.log(`api: listening on port ${port}, routes mounted under /api`);

  // Explicit timeouts: without them a client can hold sockets open by
  // dribbling out a request (slowloris). Order matters: keepAlive < headers
  // < request.
  const server = app.getHttpServer();
  server.keepAliveTimeout = 10_000;
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
}

void bootstrap();
