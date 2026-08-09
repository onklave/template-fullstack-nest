// PostgreSQL access for the `api` service.
//
// The connection string comes from DATABASE_URL and nowhere else. Onklave
// injects it per environment as a secret (see `env` in onklave.yaml). It is
// never hard-coded, never committed, and never logged — connection strings
// carry the password inline, so logging one leaks the database.

import { Pool } from 'pg';

/** Injection token for the shared pg Pool (see the provider in app.module.ts). */
export const PG_POOL = 'PG_POOL';

/**
 * Read DATABASE_URL or fail loudly.
 *
 * Deliberately no in-memory fallback: a store that quietly forgets everything
 * on restart looks healthy while losing data. Refusing to start is the honest
 * failure, and the platform will surface it as a failed rollout.
 */
export function requireDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. This service requires PostgreSQL and will not start without it. ' +
        'Onklave injects it per environment; locally, export it before `npm start`.',
    );
  }
  return url;
}

/** Create the shared connection pool the ItemsService queries through. */
export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: Number(process.env['PGPOOL_MAX']) || 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  // A pool error (server restart, network blip) is emitted on the pool, not on
  // a query. Without this listener Node treats it as an unhandled 'error' event
  // and kills the process.
  pool.on('error', (err) => console.error('postgres pool error:', err.message));

  return pool;
}
