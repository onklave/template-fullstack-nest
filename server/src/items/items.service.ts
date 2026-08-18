import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db';

/** The JSON shape of an item on the wire — identical to what the client expects. */
export interface Item {
  /**
   * A string, not a number. The column is BIGINT and node-postgres returns
   * int8 as a string so it cannot lose precision above 2^53. The id stays a
   * string all the way to the client — see Item in items.service.ts (client).
   */
  id: string;
  name: string;
  createdAt: string;
}

interface ItemRow {
  id: string | number;
  name: string;
  created_at: string | Date;
}

const toItem = (row: ItemRow): Item => ({
  id: String(row.id),
  name: row.name,
  createdAt: new Date(row.created_at).toISOString(),
});

@Injectable()
export class ItemsService implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Migrations-lite. The container is replaced on every deploy and has no
   * writable disk, so schema has to be asserted at startup rather than kept
   * in a local migration state file. Swap this for a real migration tool
   * once the schema stops being one table. Called from main.ts, which exits
   * non-zero if PostgreSQL is unreachable — no silent in-memory fallback.
   */
  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id         BIGSERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  /** Freshness: `display`. A projection — safe to cache briefly. */
  async list(): Promise<Item[]> {
    const { rows } = await this.pool.query<ItemRow>(
      'SELECT id, name, created_at FROM items ORDER BY id DESC LIMIT 100',
    );
    return rows.map(toItem);
  }

  /**
   * Freshness: `live` when a user opens one item, `transactional` when it is
   * the target of a governed action. Both mean the same thing here — the row
   * is read from PostgreSQL, the authority, on every call. Never serve this
   * from a cache and never accept the client's copy of it: see
   * architecture/data-freshness.md.
   */
  async get(id: string): Promise<Item | null> {
    const { rows } = await this.pool.query<ItemRow>(
      'SELECT id, name, created_at FROM items WHERE id = $1',
      [id],
    );
    return rows.length ? toItem(rows[0]) : null;
  }

  async create(name: string): Promise<Item> {
    const { rows } = await this.pool.query<ItemRow>(
      'INSERT INTO items (name) VALUES ($1) RETURNING id, name, created_at',
      [name],
    );
    return toItem(rows[0]);
  }

  /**
   * `app.enableShutdownHooks()` in main.ts makes Nest call this on
   * SIGTERM/SIGINT, so in-flight queries finish and the pool drains before
   * the process exits — the graceful-shutdown path of the Express template.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
