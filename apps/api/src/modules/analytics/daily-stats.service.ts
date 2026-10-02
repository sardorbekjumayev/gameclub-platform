import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { DateTime } from 'luxon';
import { REDIS } from '../../infra/redis/redis.module';
import { PrismaService } from '../../database/prisma.service';

const LOCK = 'jobs:daily_branch_stats';

/**
 * `daily_branch_stats` agregatsiyasi (§6.17). Kun — filial timezone'idagi mahalliy sana.
 * Har soatda oxirgi 2 kun qayta hisoblanadi (kechikkan to'lov/refundlar uchun); birinchi ishga tushishda 90 kun backfill.
 * Redis lock bilan bir vaqtda faqat bitta instans hisoblaydi. Upsert — idempotent.
 */
@Injectable()
export class DailyStatsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger('DailyStats');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    const tick = async () => {
      const any = await this.prisma.daily_branch_stats.count();
      await this.run(any ? 2 : 90);
    };
    setTimeout(() => tick().catch((e) => this.log.warn(`daily stats failed: ${(e as Error).message}`)), 30_000);
    this.timer = setInterval(() => tick().catch((e) => this.log.warn(`daily stats failed: ${(e as Error).message}`)), 3600_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Oxirgi `days` kun (bugun bilan) uchun barcha filiallar. */
  async run(days: number) {
    if (!(await this.redis.set(LOCK, '1', 'EX', 600, 'NX'))) return { skipped: true };
    try {
      const from = DateTime.utc().minus({ days: days + 1 }).toJSDate();
      const n = await this.prisma.$executeRaw`
        WITH br AS (SELECT id, club_id, timezone FROM branches),
        bk AS (
          SELECT b.branch_id, (b.start_at AT TIME ZONE br.timezone)::date AS d,
            COUNT(*) FILTER (WHERE b.status NOT IN ('PENDING_PAYMENT','EXPIRED'))::int AS bookings_count,
            COUNT(*) FILTER (WHERE b.status = 'COMPLETED')::int AS completed_count,
            COUNT(*) FILTER (WHERE b.status = 'CANCELLED')::int AS cancelled_count,
            COUNT(*) FILTER (WHERE b.status = 'NO_SHOW')::int AS no_show_count,
            COALESCE(SUM(b.total_amount) FILTER (WHERE b.status IN ('CONFIRMED','CHECKED_IN','ACTIVE','COMPLETED')),0)::bigint AS gmv,
            COUNT(DISTINCT b.customer_id) FILTER (WHERE b.status IN ('CONFIRMED','CHECKED_IN','ACTIVE','COMPLETED'))::int AS unique_customers
          FROM bookings b JOIN br ON br.id = b.branch_id WHERE b.start_at >= ${from} GROUP BY 1, 2),
        py AS (
          SELECT p.branch_id, (p.paid_at AT TIME ZONE br.timezone)::date AS d, SUM(p.amount)::bigint AS collected, COALESCE(SUM(p.commission_amount),0)::bigint AS commission
          FROM payments p JOIN br ON br.id = p.branch_id
          WHERE p.paid_at >= ${from} AND p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') GROUP BY 1, 2),
        rf AS (
          SELECT p.branch_id, (r.created_at AT TIME ZONE br.timezone)::date AS d, SUM(r.amount)::bigint AS refunds
          FROM refunds r JOIN payments p ON p.id = r.payment_id JOIN br ON br.id = p.branch_id
          WHERE r.created_at >= ${from} AND r.status IN ('COMPLETED','PENDING') GROUP BY 1, 2),
        ss AS (
          SELECT s.branch_id, (s.ended_at AT TIME ZONE br.timezone)::date AS d,
            SUM(GREATEST(0, EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::int - s.total_paused_seconds) / 60)::int AS session_minutes
          FROM sessions s JOIN br ON br.id = s.branch_id
          WHERE s.ended_at >= ${from} AND s.started_at IS NOT NULL GROUP BY 1, 2),
        keys AS (SELECT branch_id, d FROM bk UNION SELECT branch_id, d FROM py UNION SELECT branch_id, d FROM rf UNION SELECT branch_id, d FROM ss)
        INSERT INTO daily_branch_stats (branch_id, club_id, date, bookings_count, completed_count, cancelled_count, no_show_count, gmv, collected, refunds, commission, session_minutes, unique_customers, computed_at)
        SELECT k.branch_id, br.club_id, k.d,
          COALESCE(bk.bookings_count,0), COALESCE(bk.completed_count,0), COALESCE(bk.cancelled_count,0), COALESCE(bk.no_show_count,0),
          COALESCE(bk.gmv,0), COALESCE(py.collected,0), COALESCE(rf.refunds,0), COALESCE(py.commission,0), COALESCE(ss.session_minutes,0), COALESCE(bk.unique_customers,0), now()
        FROM keys k JOIN br ON br.id = k.branch_id
        LEFT JOIN bk ON bk.branch_id = k.branch_id AND bk.d = k.d
        LEFT JOIN py ON py.branch_id = k.branch_id AND py.d = k.d
        LEFT JOIN rf ON rf.branch_id = k.branch_id AND rf.d = k.d
        LEFT JOIN ss ON ss.branch_id = k.branch_id AND ss.d = k.d
        WHERE k.d >= (now() AT TIME ZONE br.timezone)::date - ${days}::int
        ON CONFLICT (branch_id, date) DO UPDATE SET
          bookings_count = EXCLUDED.bookings_count, completed_count = EXCLUDED.completed_count, cancelled_count = EXCLUDED.cancelled_count,
          no_show_count = EXCLUDED.no_show_count, gmv = EXCLUDED.gmv, collected = EXCLUDED.collected, refunds = EXCLUDED.refunds,
          commission = EXCLUDED.commission, session_minutes = EXCLUDED.session_minutes, unique_customers = EXCLUDED.unique_customers, computed_at = now()`;
      return { rows: n };
    } finally {
      await this.redis.del(LOCK);
    }
  }
}
