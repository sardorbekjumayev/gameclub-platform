import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Reconciliation (§6.10), har 10 daqiqada:
 * - 24 soatdan eski, provayderga yetib bormagan PENDING checkout'lar → FAILED (CHECKOUT_EXPIRED);
 * - 24 soatdan eski PROCESSING (provayder javobsiz) → ogohlantirish log'i (qo'lda tekshirish).
 * Payme o'zi 12 soatda CancelTransaction yuboradi; Click complete kelmasa to'lov o'tmagan hisoblanadi.
 */
@Injectable()
export class ReconciliationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger('Reconciliation');

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.run().catch((e) => this.log.warn(`reconciliation failed: ${(e as Error).message}`));
    }, 10 * 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()) {
    const dayAgo = new Date(now.getTime() - 24 * 3600_000);
    const stale = await this.prisma.payments.findMany({ where: { status: 'PENDING', method: { in: ['ONLINE_CARD', 'WALLET'] }, created_at: { lt: dayAgo } }, take: 500 });
    for (const p of stale) {
      await this.prisma.payments.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: 'FAILED', failed_reason: 'CHECKOUT_EXPIRED' } });
    }
    const stuck = await this.prisma.payments.count({ where: { status: 'PROCESSING', updated_at: { lt: dayAgo } } });
    if (stuck) this.log.warn(`${stuck} payment(s) stuck in PROCESSING > 24h — check provider cabinet`);
    const pendingRefunds = await this.prisma.refunds.count({ where: { status: 'PENDING', created_at: { lt: dayAgo } } });
    if (pendingRefunds) this.log.warn(`${pendingRefunds} refund(s) awaiting manual provider action > 24h`);
    return { expired: stale.length, stuck, pendingRefunds };
  }
}
