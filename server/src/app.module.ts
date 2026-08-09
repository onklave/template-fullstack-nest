import { Module } from '@nestjs/common';
import { createPool, PG_POOL, requireDatabaseUrl } from './db';
import { HealthController } from './health.controller';
import { ItemsController } from './items/items.controller';
import { ItemsService } from './items/items.service';
import { OnklaveConfigController } from './onklave-config.controller';

@Module({
  controllers: [HealthController, OnklaveConfigController, ItemsController],
  providers: [
    // One shared pool for the whole process, injected by token. Handing the
    // service a Pool (rather than letting it construct one) is the seam that
    // lets the tests run against a fake pool with no live PostgreSQL.
    { provide: PG_POOL, useFactory: () => createPool(requireDatabaseUrl()) },
    ItemsService,
  ],
})
export class AppModule {}
