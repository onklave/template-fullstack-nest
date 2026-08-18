import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ActionExecutor, STATUS_FOR_STATE } from '../actions/action-executor';
import { ActionReceipt } from '../actions/action.types';
// `import type`, deliberately: a controller may borrow an adapter's message
// SHAPE, but importing an adapter as a value would let it bypass policy,
// approval, the re-check and the audit record. The type import is erased at
// compile time, so it cannot. test/architecture.test.ts enforces the
// distinction.
import type { EmailMessage } from '../providers/console-email.provider';
import { Item, ItemsService } from './items.service';

const MAX_NAME_LENGTH = 200;
const ID_PATTERN = /^\d+$/;
const ACTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

/**
 * The /api/items routes — and the worked example of this repo's three rules.
 *
 * 1. EVERY route lives under /api — `app.setGlobalPrefix('api')` in main.ts.
 *    Onklave routes by path prefix and does NOT strip it, so a request the
 *    browser makes to /api/items arrives here as /api/items. Dropping the
 *    global prefix would make every route a 404 in production while working
 *    perfectly on localhost.
 *
 * 2. There is no CORS setup anywhere in this service, on purpose. The client
 *    bundle and this API are served from the same host behind the same auth
 *    gate, so calls are same-origin. If you find yourself reaching for
 *    `enableCors()`, the routing is wrong: check expose.path in onklave.yaml
 *    before loosening the origin policy.
 *
 * 3. Each read declares its freshness class and each side effect goes through
 *    ActionExecutor. See architecture/data-freshness.md and
 *    architecture/actions.md.
 *
 * Validation stays inline and boring — reach for ValidationPipe + DTO classes
 * when the payloads grow past a couple of fields.
 */
@Controller('items')
export class ItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly actions: ActionExecutor,
  ) {}

  /**
   * Freshness: `display`. A list for a screen; a few seconds stale is fine and
   * nothing may be authorized from it.
   */
  @Get()
  @Header('Cache-Control', 'private, max-age=5')
  list(): Promise<Item[]> {
    return this.items.list();
  }

  /** Freshness: `live`. Read on interaction, never from a cache. */
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async getOne(@Param('id') id: string): Promise<Item> {
    const item = ID_PATTERN.test(id) ? await this.items.get(id) : null;
    if (!item) {
      throw new NotFoundException();
    }
    return item;
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

  /**
   * A governed side effect: email someone about this item.
   *
   * The controller's whole job is to turn an HTTP request into an
   * ActionRequest and hand it to the executor. It resolves no credential,
   * chooses no provider and performs no side effect of its own — everything
   * that makes this safe (policy, approval, re-check, idempotency, audit) is
   * in ActionExecutor, once, for every action.
   *
   * The response is the receipt. Its `state` is the answer; the HTTP status
   * only mirrors it.
   */
  @Post(':id/notify')
  async notify(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ActionReceipt> {
    const { actionId, to } = this.readNotifyRequest(body);
    if (!ID_PATTERN.test(id)) {
      throw new NotFoundException();
    }

    const receipt = await this.actions.execute(
      {
        actionId,
        // A capability, not a provider. Which adapter sends the mail is the
        // registry's business (app.module.ts).
        capability: 'email.send',
        // This app has no authentication of its own — it relies on the Onklave
        // gate in front of the shared host. When you add one, put the verified
        // token's subject here: see architecture/auth.md.
        actor: 'user:anonymous',
        input: { to },
      },
      // THE AUTHORITATIVE RE-CHECK (freshness: `transactional`). It runs
      // immediately before execution and returns the value that is actually
      // executed. The item name in the email is therefore the committed one,
      // never a stale copy the client sent back; and if the item was deleted
      // between the click and this moment, `null` aborts the action.
      async () => {
        const item = await this.items.get(id);
        if (!item) {
          return null;
        }
        const message: EmailMessage = {
          to,
          subject: `Item ${item.id}`,
          body: `"${item.name}" was created at ${item.createdAt}.`,
        };
        return message;
      },
    );

    res.status(STATUS_FOR_STATE[receipt.state]);
    return receipt;
  }

  /** Envelope validation. The action's own input is validated by the provider. */
  private readNotifyRequest(body: unknown): { actionId: string; to: string } {
    const raw = (body ?? {}) as { actionId?: unknown; to?: unknown };
    const actionId = typeof raw.actionId === 'string' ? raw.actionId : '';
    const to = typeof raw.to === 'string' ? raw.to.trim() : '';
    if (!ACTION_ID_PATTERN.test(actionId)) {
      // The client supplies it so that a retry of the same click is the same
      // action; without it every retry would be a fresh send.
      throw new HttpException({ error: 'actionId must be 1-100 characters of [A-Za-z0-9_-]' }, 400);
    }
    if (!EMAIL_PATTERN.test(to)) {
      throw new HttpException({ error: 'to must be an email address' }, 400);
    }
    return { actionId, to };
  }
}
