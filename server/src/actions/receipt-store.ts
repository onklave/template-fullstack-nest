import { Pool } from 'pg';
import { ActionReceipt } from './action.types';

/** Injection token for the store ActionExecutor reserves keys in. */
export const RECEIPT_STORE = 'RECEIPT_STORE';

/**
 * Where the idempotency record for a governed action lives.
 *
 * The contract is three calls, and the middle one is the whole point:
 * `reserve` must be ATOMIC — exactly one caller may win a given execution key,
 * and every other caller must be handed the winner's receipt instead of
 * running the side effect a second time.
 *
 * See architecture/actions.md ("Idempotency") and
 * decisions/ADR-0008-durable-action-receipts.md.
 */
export interface ReceiptStore {
  /** Assert whatever storage this implementation needs. Called once, at boot. */
  ensureSchema(): Promise<void>;

  /** The receipt already recorded for this execution key, if any. */
  find(key: string): Promise<ActionReceipt | undefined>;

  /**
   * Claim the execution key before the side effect happens. Returns
   * `undefined` when this caller won the claim and may proceed, or the receipt
   * that already holds the key when it did not — in which case the caller must
   * return that receipt and execute nothing.
   */
  reserve(key: string, receipt: ActionReceipt): Promise<ActionReceipt | undefined>;

  /** Replace a reserved receipt with its terminal state. */
  complete(key: string, receipt: ActionReceipt): Promise<void>;
}

/**
 * The store the unit tests and any process without a database use.
 *
 * NOT the production store: a Map is per-process, so two replicas do not share
 * it and a restart forgets everything. app.module.ts wires the PostgreSQL one.
 */
export class InMemoryReceiptStore implements ReceiptStore {
  private readonly receipts = new Map<string, ActionReceipt>();

  async ensureSchema(): Promise<void> {
    // Nothing to assert.
  }

  async find(key: string): Promise<ActionReceipt | undefined> {
    return this.receipts.get(key);
  }

  async reserve(key: string, receipt: ActionReceipt): Promise<ActionReceipt | undefined> {
    const held = this.receipts.get(key);
    if (held) {
      return held;
    }
    this.receipts.set(key, receipt);
    return undefined;
  }

  async complete(key: string, receipt: ActionReceipt): Promise<void> {
    this.receipts.set(key, receipt);
  }
}

/**
 * The production store: one row per execution key, claimed with
 * `INSERT … ON CONFLICT DO NOTHING`.
 *
 * PostgreSQL's primary key is what makes `reserve` atomic, so idempotency
 * survives more than one replica and more than one process lifetime — which a
 * Map cannot do, and which stops mattering only if you are certain this app
 * will forever run exactly one pod and never restart mid-request.
 *
 * The table grows one row per governed action and nothing prunes it. Add a
 * retention job (or a partition) when the volume justifies one; do not shorten
 * it below the window in which a client might retry.
 */
export class PostgresReceiptStore implements ReceiptStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Asserted at boot from main.ts, the same migrations-lite pattern
   * ItemsService uses — so the table is never absent at execute time and the
   * executor needs no "database missing" fallback. A fallback would be a
   * store that silently stops being idempotent, which is the failure this
   * class exists to prevent.
   */
  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS action_receipts (
        execution_key TEXT PRIMARY KEY,
        receipt       JSONB NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async find(key: string): Promise<ActionReceipt | undefined> {
    const { rows } = await this.pool.query<{ receipt: ActionReceipt }>(
      'SELECT receipt FROM action_receipts WHERE execution_key = $1',
      [key],
    );
    return rows.length ? rows[0].receipt : undefined;
  }

  async reserve(key: string, receipt: ActionReceipt): Promise<ActionReceipt | undefined> {
    const { rows } = await this.pool.query<{ execution_key: string }>(
      `INSERT INTO action_receipts (execution_key, receipt) VALUES ($1, $2)
         ON CONFLICT (execution_key) DO NOTHING
         RETURNING execution_key`,
      [key, JSON.stringify(receipt)],
    );
    if (rows.length) {
      return undefined; // we hold the key
    }
    // Lost the race (or this is a retry): hand back what is already recorded.
    // A row is guaranteed to exist — the conflict is what brought us here.
    return this.find(key);
  }

  async complete(key: string, receipt: ActionReceipt): Promise<void> {
    await this.pool.query(
      'UPDATE action_receipts SET receipt = $2, updated_at = now() WHERE execution_key = $1',
      [key, JSON.stringify(receipt)],
    );
  }
}
