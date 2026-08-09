import { Controller, Get } from '@nestjs/common';

/**
 * Liveness/readiness probe. Onklave polls this (see healthPath in
 * onklave.yaml). Like every other route it lives under the global /api
 * prefix — the platform does not strip the route prefix, so the probe path
 * is /api/healthz, not /healthz.
 */
@Controller('healthz')
export class HealthController {
  @Get()
  health(): { status: string } {
    return { status: 'ok' };
  }
}
