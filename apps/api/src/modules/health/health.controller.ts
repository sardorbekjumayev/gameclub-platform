import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowDuringMaintenance, Public } from '../../common/decorators/auth.decorators';
import type { Response } from 'express';
import Redis from 'ioredis';
import { PrismaService } from '../../database/prisma.service';
import { REDIS } from '../../infra/redis/redis.module';
import { NoRateLimit } from '../../common/rate-limit/rate-limit.decorators';

@NoRateLimit()
@Public()
@ApiTags('health')
@AllowDuringMaintenance()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: DB va Redis' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'ok').catch(() => 'down'),
      this.redis.ping().then(() => 'ok').catch(() => 'down'),
    ]);
    const ok = db === 'ok' && redis === 'ok';
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', checks: { db, redis } };
  }
}
