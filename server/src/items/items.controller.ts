import { Body, Controller, Get, HttpException, Post } from '@nestjs/common';
import { Item, ItemsService } from './items.service';

const MAX_NAME_LENGTH = 200;

/**
 * The /api/items routes.
 *
 * EVERY route lives under /api — `app.setGlobalPrefix('api')` in main.ts.
 * Onklave routes by path prefix and does NOT strip it, so a request the
 * browser makes to /api/items arrives here as /api/items. Dropping the global
 * prefix would make every route a 404 in production while working perfectly
 * on localhost.
 *
 * There is no CORS setup anywhere in this service, on purpose. The client
 * bundle and this API are served from the same host behind the same auth
 * gate, so calls are same-origin. If you find yourself reaching for
 * `enableCors()`, the routing is wrong: check expose.path in onklave.yaml
 * before loosening the origin policy.
 *
 * Validation stays inline and boring — one field, two rules. Reach for
 * ValidationPipe + DTO classes when the payloads grow past that.
 */
@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  list(): Promise<Item[]> {
    return this.items.list();
  }

  // Nest returns 201 for POST by default — same as the Express template.
  @Post()
  create(@Body() body: unknown): Promise<Item> {
    const raw = (body as { name?: unknown } | null)?.name;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) {
      // The object body (not a bare string) keeps the wire shape identical to
      // the Express template: {"error":"name must be 1-200 characters"}.
      throw new HttpException({ error: `name must be 1-${MAX_NAME_LENGTH} characters` }, 400);
    }
    return this.items.create(name);
  }
}
