import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ActionExecutor } from './actions/action-executor';
import { ACTION_POLICY, ApprovalStore, PolicyRules } from './actions/policy';
import { PostgresReceiptStore, RECEIPT_STORE } from './actions/receipt-store';
import { createPool, PG_POOL, requireDatabaseUrl } from './db';
import { HealthController } from './health.controller';
import { ItemsController } from './items/items.controller';
import { ItemsService } from './items/items.service';
import { ConsoleEmailProvider } from './providers/console-email.provider';
import { ProviderRegistry } from './providers/provider-registry';
import { OnklaveConfigController } from './onklave-config.controller';

/**
 * What this app may do, and what does it. Both lines below are governance, and
 * both must agree with onklave.yaml — `capabilities:` and `approvals:` there,
 * ACTION_POLICY here; the platform reads the manifest, the runtime enforces
 * this table.
 *
 * Exported so `test/architecture.test.ts` can assert it against `capabilities:`
 * in onklave.yaml — the two declarations are checked for agreement rather than
 * trusted to stay in step.
 */
export const POLICY: PolicyRules = {
  // `automatic` = allowed without human approval. `required` = ActionExecutor
  // will not run it until an approval exists for this exact revision.
  'email.send': 'automatic',
};

/** Every integration this app has. Adding one: skills/add-provider/SKILL.md. */
const PROVIDERS = [new ConsoleEmailProvider()];

@Module({
  controllers: [HealthController, OnklaveConfigController, ItemsController],
  providers: [
    // One shared pool for the whole process, injected by token. Handing the
    // service a Pool (rather than letting it construct one) is the seam that
    // lets the tests run against a fake pool with no live PostgreSQL.
    { provide: PG_POOL, useFactory: () => createPool(requireDatabaseUrl()) },
    ItemsService,

    // The action boundary. A capability that is not in POLICY cannot execute,
    // and nothing executes except through ActionExecutor.
    { provide: ACTION_POLICY, useValue: POLICY },
    { provide: ProviderRegistry, useFactory: () => new ProviderRegistry(PROVIDERS) },
    // Idempotency in PostgreSQL, not in a Map: the execution key is claimed
    // with a primary-key insert, so a duplicate action cannot execute twice
    // even across replicas or a restart (ADR-0008). The table is asserted at
    // boot in main.ts.
    {
      provide: RECEIPT_STORE,
      useFactory: (pool: Pool) => new PostgresReceiptStore(pool),
      inject: [PG_POOL],
    },
    ApprovalStore,
    ActionExecutor,
  ],
})
export class AppModule {}
