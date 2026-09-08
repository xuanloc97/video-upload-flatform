import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { UploadsHealthIndicator } from './uploads.health';

/**
 * Health endpoints backed by `@nestjs/terminus` (design "Health").
 *
 * - `GET /health/live` — liveness: a lightweight "the process is up and answering" check with no
 *   dependency probing, so it always responds quickly and well within 5 seconds (Req 5.1, 5.3).
 * - `GET /health/ready` — readiness: verifies the shared `/uploads` volume is reachable/writable so
 *   a pod that has lost storage is pulled from rotation (Req 5.2).
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly uploads: UploadsHealthIndicator,
  ) {}

  @Get('live')
  @HealthCheck()
  live() {
    // No external dependencies: liveness only reports that the event loop is responsive.
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.uploads.isHealthy()]);
  }
}
