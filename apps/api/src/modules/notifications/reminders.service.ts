import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { fmtTime, fmtWhen } from '../../common/utils/format';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from './notifications.service';

const MIN = 60_000;

/**
 * Eslatmalar (§6.15): BOOKING_REMINDER (start−60 va −15 daq), SESSION_ENDING_SOON (−10 daq),
 * REVIEW_REQUEST (yakunlangandan 1 soat keyin). Har biri dedupe_key bilan — bir necha replika
 * yoki qayta ishga tushirishda takror yuborilmaydi.
 */
@Injectable()
export class RemindersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger('Reminders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.run().catch((e) => this.log.warn(`reminders failed: ${(e as Error).message}`));
    }, MIN);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()) {
    let sent = 0;
    const t = now.getTime();

    // Bron eslatmalari: oyna ichidagi (start − N daq ≤ now) va hali boshlanmagan bronlar
    for (const minutes of [60, 15]) {
      const bookings = await this.prisma.bookings.findMany({
        where: { status: 'CONFIRMED', start_at: { gt: now, lte: new Date(t + minutes * MIN) }, created_at: { lt: new Date(t - 60_000) } },
        take: 500,
      });
      const branches = await this.branchInfo(bookings.map((b) => b.branch_id));
      for (const b of bookings) {
        // −60 oynasiga −15 ichidagi bronlar ham tushadi; ular faqat −15 eslatmasini oladi
        if (minutes === 60 && b.start_at.getTime() - t <= 15 * MIN) continue;
        const br = branches.get(b.branch_id);
        await this.notifications.notify(
          [b.customer_id], 'BOOKING_REMINDER',
          { code: b.code, club: br?.club ?? '', when: fmtWhen(b.start_at, br?.tz), minutes },
          { booking_id: b.id }, { dedupe_key: `reminder:${b.id}:${minutes}` },
        );
        sent++;
      }
    }

    // Sessiya tugashiga 10 daqiqa
    const sessions = await this.prisma.sessions.findMany({
      where: { status: 'ACTIVE', customer_id: { not: null }, expected_end_at: { gt: now, lte: new Date(t + 10 * MIN) } },
      take: 500,
    });
    const sBranches = await this.branchInfo(sessions.map((s) => s.branch_id));
    for (const s of sessions) {
      await this.notifications.notify(
        [s.customer_id], 'SESSION_ENDING_SOON',
        { until: fmtTime(s.expected_end_at!, sBranches.get(s.branch_id)?.tz) },
        { session_id: s.id, booking_id: s.booking_id }, { dedupe_key: `ending:${s.id}:${s.expected_end_at!.getTime()}` },
      );
      sent++;
    }

    // Sharh so'rovi: yakunlangan, sharhsiz, 1–24 soat oldin tugagan bronlar
    const done = await this.prisma.bookings.findMany({
      where: { status: 'COMPLETED', end_at: { lte: new Date(t - 60 * MIN), gt: new Date(t - 24 * 60 * MIN) } },
      take: 500,
    });
    const reviewed = new Set((await this.prisma.reviews.findMany({ where: { booking_id: { in: done.map((b) => b.id) } }, select: { booking_id: true } })).map((r) => r.booking_id));
    const dBranches = await this.branchInfo(done.map((b) => b.branch_id));
    for (const b of done) {
      if (reviewed.has(b.id)) continue;
      await this.notifications.notify([b.customer_id], 'REVIEW_REQUEST', { club: dBranches.get(b.branch_id)?.club ?? '', code: b.code }, { booking_id: b.id, branch_id: b.branch_id }, { dedupe_key: `review:${b.id}` });
      sent++;
    }
    return { sent };
  }

  private async branchInfo(ids: string[]) {
    const rows = await this.prisma.branches.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, timezone: true, club: { select: { name: true } } } });
    return new Map(rows.map((r) => [r.id, { tz: r.timezone, club: r.club.name }]));
  }
}
