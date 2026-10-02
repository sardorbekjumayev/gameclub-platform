import ExcelJS from 'exceljs';
import { Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { DateTime } from 'luxon';
import { WorkingHours, openIntervals } from '../../common/domain/working-hours';
import { AppException } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import { assertCan, branchesInClub } from '../rbac/access';
import { Grant } from '../rbac/rbac.service';

export class ClubAnalyticsQuery {
  @ApiProperty() @IsUUID() club_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branch_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'] }) @IsOptional() @IsIn(['day', 'week', 'month']) group?: 'day' | 'week' | 'month';
  @ApiPropertyOptional({ enum: ['csv', 'xlsx'] }) @IsOptional() @IsIn(['csv', 'xlsx']) format?: 'csv' | 'xlsx';
}

export class PlatformAnalyticsQuery {
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

const CONFIRMED = ['CONFIRMED', 'CHECKED_IN', 'ACTIVE', 'COMPLETED'];
const PAID = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const TZ = 'Asia/Tashkent';

/**
 * Metrikalar (docs/01-API.md §6.17): GMV = tasdiqlangan bronlar total_amount; Collected = PAID to'lovlar;
 * Net = collected − refunds; Club revenue = Net − commission; Occupancy = band daqiqa / (qurilma × ish vaqti).
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(from?: string, to?: string) {
    const end = to ? new Date(to) : DateTime.now().setZone(TZ).endOf('day').toJSDate();
    const start = from ? new Date(from) : DateTime.fromJSDate(end).setZone(TZ).minus({ days: 29 }).startOf('day').toJSDate();
    if (end <= start) throw new AppException('VALIDATION_ERROR', '"to" must be after "from"', {});
    if (end.getTime() - start.getTime() > 400 * 86400_000) throw new AppException('VALIDATION_ERROR', 'Range too large (max 400 days)', {});
    return { start, end };
  }

  private scope(q: ClubAnalyticsQuery, grants: Grant[]) {
    assertCan(grants, 'reports.view', { club_id: q.club_id, branch_id: q.branch_id });
    const allowed = branchesInClub(grants, 'reports.view', q.club_id);
    const branchIds = q.branch_id ? [q.branch_id] : allowed;
    return { club_id: q.club_id, ...(branchIds ? { branch_id: { in: branchIds } } : {}) };
  }

  private async money(where: { club_id?: string; branch_id?: { in: string[] } }, start: Date, end: Date) {
    const [gmv, paid, refunds, bookings] = await Promise.all([
      this.prisma.bookings.aggregate({ where: { ...where, status: { in: CONFIRMED }, start_at: { gte: start, lt: end } }, _sum: { total_amount: true, discount_amount: true }, _count: true }),
      this.prisma.payments.aggregate({ where: { ...where, status: { in: PAID }, paid_at: { gte: start, lt: end } }, _sum: { amount: true, commission_amount: true }, _count: true }),
      this.prisma.refunds.aggregate({ where: { club_id: where.club_id, created_at: { gte: start, lt: end }, ...(where.branch_id ? { booking_id: { in: (await this.prisma.bookings.findMany({ where: { branch_id: where.branch_id }, select: { id: true } })).map((b) => b.id) } } : {}) }, _sum: { amount: true } }),
      this.prisma.bookings.groupBy({ by: ['status'], where: { ...where, start_at: { gte: start, lt: end } }, _count: true }),
    ]);
    const collected = paid._sum.amount ?? 0n;
    const refunded = refunds._sum.amount ?? 0n;
    const commission = paid._sum.commission_amount ?? 0n;
    const byStatus = Object.fromEntries(bookings.map((b) => [b.status, b._count]));
    const total = bookings.reduce((s, b) => s + b._count, 0);
    return {
      gmv: gmv._sum.total_amount ?? 0n,
      discounts: gmv._sum.discount_amount ?? 0n,
      collected,
      refunds: refunded,
      net: collected - refunded,
      commission,
      club_revenue: collected - refunded - commission,
      payments_count: paid._count,
      bookings_total: total,
      bookings_confirmed: gmv._count,
      bookings_by_status: byStatus,
      avg_booking_value: gmv._count ? (gmv._sum.total_amount ?? 0n) / BigInt(gmv._count) : 0n,
      cancellation_rate: total ? ((byStatus.CANCELLED ?? 0) / total) : 0,
      no_show_rate: total ? ((byStatus.NO_SHOW ?? 0) / total) : 0,
    };
  }

  async clubOverview(q: ClubAnalyticsQuery, grants: Grant[]) {
    const where = this.scope(q, grants);
    const { start, end } = this.range(q.from, q.to);
    const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
    const [current, previous, occupancy, customers, live] = await Promise.all([
      this.money(where, start, end),
      this.money(where, prevStart, start),
      this.occupancyValue(where, start, end),
      this.customerStats(where, start, end),
      this.prisma.sessions.count({ where: { ...where, status: { in: ['ACTIVE', 'PAUSED'] } } }),
    ]);
    return { range: { from: start, to: end }, ...current, occupancy, customers, active_sessions: live, previous: { gmv: previous.gmv, collected: previous.collected, net: previous.net, bookings_confirmed: previous.bookings_confirmed } };
  }

  private async customerStats(where: object, start: Date, end: Date) {
    const inRange = await this.prisma.bookings.findMany({ where: { ...where, customer_id: { not: null }, status: { in: CONFIRMED }, start_at: { gte: start, lt: end } }, select: { customer_id: true }, distinct: ['customer_id'] });
    const ids = inRange.map((r) => r.customer_id!);
    const returning = ids.length
      ? (await this.prisma.bookings.findMany({ where: { ...where, customer_id: { in: ids }, status: { in: CONFIRMED }, start_at: { lt: start } }, select: { customer_id: true }, distinct: ['customer_id'] })).length
      : 0;
    return { unique: ids.length, returning, new: ids.length - returning, repeat_rate: ids.length ? returning / ids.length : 0 };
  }

  /** Bandlik: band daqiqalar / (faol qurilmalar × ish vaqti daqiqalari). */
  private async occupancyValue(where: { club_id?: string; branch_id?: { in: string[] } }, start: Date, end: Date) {
    const branches = await this.prisma.branches.findMany({ where: { club_id: where.club_id, deleted_at: null, ...(where.branch_id ? { id: where.branch_id } : {}) } });
    let capacity = 0;
    for (const b of branches) {
      const devices = await this.prisma.devices.count({ where: { branch_id: b.id, deleted_at: null, operational_status: { not: 'DISABLED' } } });
      const open = openIntervals(b.working_hours as WorkingHours, [], b.timezone, start, end).reduce((s, [a, z]) => s + Math.max(0, Math.min(z, end.getTime()) - Math.max(a, start.getTime())), 0) / 60_000;
      capacity += devices * open;
    }
    const rows = await this.prisma.$queryRaw<{ minutes: number }[]>`
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(bi.end_at, ${end}) - GREATEST(bi.start_at, ${start}))) / 60), 0)::float AS minutes
      FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
      WHERE b.club_id = ${where.club_id}::uuid AND b.status IN ('CONFIRMED','CHECKED_IN','ACTIVE','COMPLETED')
        AND bi.start_at < ${end} AND bi.end_at > ${start}
        ${where.branch_id ? Prisma.sql`AND b.branch_id = ANY(${where.branch_id.in}::uuid[])` : Prisma.empty}`;
    const busy = rows[0]?.minutes ?? 0;
    return { busy_minutes: Math.round(busy), capacity_minutes: Math.round(capacity), rate: capacity ? Math.min(1, busy / capacity) : 0 };
  }

  async revenue(q: ClubAnalyticsQuery, grants: Grant[]) {
    const where = this.scope(q, grants);
    const { start, end } = this.range(q.from, q.to);
    const unit = q.group ?? 'day';
    const branchSql = where.branch_id ? Prisma.sql`AND branch_id = ANY(${where.branch_id.in}::uuid[])` : Prisma.empty;
    const pays = await this.prisma.$queryRaw<{ bucket: Date; collected: bigint; commission: bigint; count: bigint }[]>`
      SELECT date_trunc(${unit}, paid_at AT TIME ZONE ${TZ}) AS bucket, SUM(amount)::bigint AS collected, COALESCE(SUM(commission_amount),0)::bigint AS commission, COUNT(*)::bigint AS count
      FROM payments WHERE club_id = ${q.club_id}::uuid AND status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND paid_at >= ${start} AND paid_at < ${end} ${branchSql}
      GROUP BY 1 ORDER BY 1`;
    const bks = await this.prisma.$queryRaw<{ bucket: Date; gmv: bigint; count: bigint }[]>`
      SELECT date_trunc(${unit}, start_at AT TIME ZONE ${TZ}) AS bucket, SUM(total_amount)::bigint AS gmv, COUNT(*)::bigint AS count
      FROM bookings WHERE club_id = ${q.club_id}::uuid AND status IN ('CONFIRMED','CHECKED_IN','ACTIVE','COMPLETED') AND start_at >= ${start} AND start_at < ${end} ${branchSql}
      GROUP BY 1 ORDER BY 1`;
    const refunds = await this.prisma.$queryRaw<{ bucket: Date; refunds: bigint }[]>`
      SELECT date_trunc(${unit}, created_at AT TIME ZONE ${TZ}) AS bucket, SUM(amount)::bigint AS refunds
      FROM refunds WHERE club_id = ${q.club_id}::uuid AND created_at >= ${start} AND created_at < ${end}
      ${where.branch_id ? Prisma.sql`AND payment_id IN (SELECT id FROM payments WHERE branch_id = ANY(${where.branch_id.in}::uuid[]))` : Prisma.empty}
      GROUP BY 1 ORDER BY 1`;
    const key = (d: Date) => d.toISOString().slice(0, 10);
    const series = new Map<string, { date: string; collected: bigint; commission: bigint; refunds: bigint; gmv: bigint; bookings: number; payments: number }>();
    let cursor = DateTime.fromJSDate(start).setZone(TZ).startOf(unit);
    while (cursor.toJSDate() < end) {
      const k = cursor.toFormat('yyyy-MM-dd');
      series.set(k, { date: k, collected: 0n, commission: 0n, refunds: 0n, gmv: 0n, bookings: 0, payments: 0 });
      cursor = cursor.plus({ [`${unit}s`]: 1 });
    }
    const get = (d: Date) => series.get(key(d)) ?? series.set(key(d), { date: key(d), collected: 0n, commission: 0n, refunds: 0n, gmv: 0n, bookings: 0, payments: 0 }).get(key(d))!;
    for (const r of pays) Object.assign(get(r.bucket), { collected: r.collected, commission: r.commission, payments: Number(r.count) });
    for (const r of bks) Object.assign(get(r.bucket), { gmv: r.gmv, bookings: Number(r.count) });
    for (const r of refunds) get(r.bucket).refunds = r.refunds;
    return [...series.values()].sort((a, b) => a.date.localeCompare(b.date)).map((s) => ({ ...s, net: s.collected - s.refunds }));
  }

  /** Peak hours heatmap: hafta kuni (1–7) × soat (0–23) — band daqiqalar. */
  async peakHours(q: ClubAnalyticsQuery, grants: Grant[]) {
    const where = this.scope(q, grants);
    const { start, end } = this.range(q.from, q.to);
    const branchSql = where.branch_id ? Prisma.sql`AND b.branch_id = ANY(${where.branch_id.in}::uuid[])` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ dow: number; hour: number; bookings: bigint }[]>`
      SELECT EXTRACT(ISODOW FROM h AT TIME ZONE ${TZ})::int AS dow, EXTRACT(HOUR FROM h AT TIME ZONE ${TZ})::int AS hour, COUNT(*)::bigint AS bookings
      FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id,
           generate_series(date_trunc('hour', bi.start_at), bi.end_at - interval '1 minute', interval '1 hour') AS h
      WHERE b.club_id = ${q.club_id}::uuid AND b.status IN ('CONFIRMED','CHECKED_IN','ACTIVE','COMPLETED') AND bi.start_at >= ${start} AND bi.start_at < ${end} ${branchSql}
      GROUP BY 1, 2`;
    return rows.map((r) => ({ dow: r.dow, hour: r.hour, value: Number(r.bookings) }));
  }

  async popularDevices(q: ClubAnalyticsQuery, grants: Grant[]) {
    const where = this.scope(q, grants);
    const { start, end } = this.range(q.from, q.to);
    const rows = await this.prisma.booking_items.groupBy({
      by: ['device_id'],
      where: { club_id: q.club_id, ...(where.branch_id ? { branch_id: where.branch_id } : {}), start_at: { gte: start, lt: end }, booking: { status: { in: CONFIRMED } } },
      _count: true,
      _sum: { price_amount: true },
      orderBy: { _count: { device_id: 'desc' } },
      take: 20,
    });
    const devices = await this.prisma.devices.findMany({ where: { id: { in: rows.map((r) => r.device_id) } }, select: { id: true, name: true, type: true, branch_id: true } });
    const d = new Map(devices.map((x) => [x.id, x]));
    return rows.map((r) => ({ device: d.get(r.device_id) ?? null, bookings: r._count, revenue: r._sum.price_amount ?? 0n }));
  }

  async compareBranches(q: ClubAnalyticsQuery, grants: Grant[]) {
    assertCan(grants, 'reports.view', { club_id: q.club_id });
    const { start, end } = this.range(q.from, q.to);
    const allowed = branchesInClub(grants, 'reports.view', q.club_id);
    const branches = await this.prisma.branches.findMany({ where: { club_id: q.club_id, deleted_at: null, ...(allowed ? { id: { in: allowed } } : {}) }, select: { id: true, name: true, rating_avg: true } });
    return Promise.all(
      branches.map(async (b) => {
        const w = { club_id: q.club_id, branch_id: { in: [b.id] } };
        const [m, occ] = await Promise.all([this.money(w, start, end), this.occupancyValue(w, start, end)]);
        return { branch: b, gmv: m.gmv, collected: m.collected, net: m.net, bookings: m.bookings_confirmed, occupancy: occ.rate, cancellation_rate: m.cancellation_rate };
      }),
    );
  }

  // ---------- Platforma ----------
  async platformOverview(q: PlatformAnalyticsQuery) {
    const { start, end } = this.range(q.from, q.to);
    const [clubs, users, money, newUsers, topClubs] = await Promise.all([
      this.prisma.clubs.groupBy({ by: ['status'], where: { deleted_at: null }, _count: true }),
      this.prisma.users.groupBy({ by: ['type'], where: { deleted_at: null }, _count: true }),
      this.money({}, start, end),
      this.prisma.users.count({ where: { created_at: { gte: start, lt: end }, type: 'CUSTOMER' } }),
      this.prisma.payments.groupBy({ by: ['club_id'], where: { status: { in: PAID }, paid_at: { gte: start, lt: end } }, _sum: { amount: true, commission_amount: true }, orderBy: { _sum: { amount: 'desc' } }, take: 10 }),
    ]);
    const names = await this.prisma.clubs.findMany({ where: { id: { in: topClubs.map((t) => t.club_id) } }, select: { id: true, name: true } });
    const n = new Map(names.map((x) => [x.id, x.name]));
    const branches = await this.prisma.branches.count({ where: { deleted_at: null, status: 'ACTIVE' } });
    const devices = await this.prisma.devices.count({ where: { deleted_at: null } });
    const pending = await this.prisma.clubs.count({ where: { status: 'PENDING_APPROVAL' } });
    const tickets = await this.prisma.support_tickets.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } });
    const reviewsQueue = await this.prisma.reviews.count({ where: { status: 'PENDING_MODERATION' } });
    return {
      range: { from: start, to: end },
      clubs_by_status: Object.fromEntries(clubs.map((c) => [c.status, c._count])),
      users_by_type: Object.fromEntries(users.map((u) => [u.type, u._count])),
      new_customers: newUsers,
      active_branches: branches,
      devices,
      queues: { pending_clubs: pending, open_tickets: tickets, reviews_to_moderate: reviewsQueue },
      ...money,
      top_clubs: topClubs.map((t) => ({ club_id: t.club_id, name: n.get(t.club_id) ?? null, collected: t._sum.amount ?? 0n, commission: t._sum.commission_amount ?? 0n })),
    };
  }

  async platformGrowth(q: PlatformAnalyticsQuery) {
    const { start, end } = this.range(q.from, q.to);
    const rows = await this.prisma.$queryRaw<{ day: Date; bookings: bigint; gmv: bigint }[]>`
      SELECT date_trunc('day', start_at AT TIME ZONE ${TZ}) AS day, COUNT(*)::bigint AS bookings, COALESCE(SUM(total_amount),0)::bigint AS gmv
      FROM bookings WHERE status IN ('CONFIRMED','CHECKED_IN','ACTIVE','COMPLETED') AND start_at >= ${start} AND start_at < ${end} GROUP BY 1 ORDER BY 1`;
    const users = await this.prisma.$queryRaw<{ day: Date; users: bigint }[]>`
      SELECT date_trunc('day', created_at AT TIME ZONE ${TZ}) AS day, COUNT(*)::bigint AS users FROM users
      WHERE created_at >= ${start} AND created_at < ${end} GROUP BY 1 ORDER BY 1`;
    const map = new Map<string, { date: string; bookings: number; gmv: bigint; new_users: number }>();
    for (let c = DateTime.fromJSDate(start).setZone(TZ).startOf('day'); c.toJSDate() < end; c = c.plus({ days: 1 })) {
      const k = c.toFormat('yyyy-MM-dd');
      map.set(k, { date: k, bookings: 0, gmv: 0n, new_users: 0 });
    }
    for (const r of rows) {
      const e = map.get(r.day.toISOString().slice(0, 10));
      if (e) Object.assign(e, { bookings: Number(r.bookings), gmv: r.gmv });
    }
    for (const r of users) {
      const e = map.get(r.day.toISOString().slice(0, 10));
      if (e) e.new_users = Number(r.users);
    }
    return [...map.values()];
  }

  /** Kunlik agregatlar (`daily_branch_stats`, soatda yangilanadi) — og'ir davrlar uchun tez manba. */
  async daily(q: ClubAnalyticsQuery, grants: Grant[]) {
    const where = this.scope(q, grants);
    const { start, end } = this.range(q.from, q.to);
    const d = (x: Date) => new Date(`${DateTime.fromJSDate(x, { zone: TZ }).toISODate()}T00:00:00Z`);
    const rows = await this.prisma.daily_branch_stats.groupBy({
      by: ['date'],
      where: { club_id: q.club_id, ...(where.branch_id ? { branch_id: where.branch_id } : {}), date: { gte: d(start), lte: d(new Date(end.getTime() - 1)) } },
      _sum: { bookings_count: true, completed_count: true, cancelled_count: true, no_show_count: true, gmv: true, collected: true, refunds: true, commission: true, session_minutes: true, unique_customers: true },
      orderBy: { date: 'asc' },
    });
    const computed = await this.prisma.daily_branch_stats.aggregate({ where: { club_id: q.club_id }, _max: { computed_at: true } });
    return { computed_at: computed._max.computed_at, days: rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), ...r._sum, net: (r._sum.collected ?? 0n) - (r._sum.refunds ?? 0n) })) };
  }

  // ---------- Eksport (CSV) ----------
  async exportCsv(kind: 'bookings' | 'payments' | 'shifts', q: ClubAnalyticsQuery, grants: Grant[]) {
    const t = await this.exportTable(kind, q, grants);
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return '\uFEFF' + [t.header, ...t.rows].map((r) => r.map(esc).join(',')).join('\n');
  }

  /** XLSX: sanalar filial TZ emas, UTC (Excel'da sana formatida), summalar so'mda son sifatida. */
  async exportXlsx(kind: 'bookings' | 'payments' | 'shifts', q: ClubAnalyticsQuery, grants: Grant[]) {
    const t = await this.exportTable(kind, q, grants);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(kind);
    ws.addRow(t.header).font = { bold: true };
    for (const r of t.rows) ws.addRow(r);
    t.header.forEach((h, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.max(12, h.length + 2);
      if (h.endsWith('_som')) col.numFmt = '#,##0.00';
      if (h.endsWith('_at')) col.numFmt = 'yyyy-mm-dd hh:mm';
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async exportTable(kind: 'bookings' | 'payments' | 'shifts', q: ClubAnalyticsQuery, grants: Grant[]): Promise<{ header: string[]; rows: unknown[][] }> {
    assertCan(grants, 'reports.export', { club_id: q.club_id, branch_id: q.branch_id });
    const allowed = branchesInClub(grants, 'reports.export', q.club_id);
    const where = { club_id: q.club_id, ...(q.branch_id ? { branch_id: q.branch_id } : allowed ? { branch_id: { in: allowed } } : {}) };
    const { start, end } = this.range(q.from, q.to);
    const table = (header: string[], rows: unknown[][]) => ({ header, rows });
    const som = (t: bigint | null) => (t === null ? null : Number(t) / 100);
    if (kind === 'bookings') {
      const rows = await this.prisma.bookings.findMany({ where: { ...where, start_at: { gte: start, lt: end } }, orderBy: { start_at: 'asc' }, take: 50_000 });
      return table(
        ['code', 'status', 'source', 'start_at', 'end_at', 'duration_min', 'subtotal_som', 'discount_som', 'total_som', 'paid_som', 'payment_status', 'guest_name', 'created_at'],
        rows.map((r) => [r.code, r.status, r.source, r.start_at, r.end_at, r.duration_minutes, som(r.subtotal_amount), som(r.discount_amount), som(r.total_amount), som(r.paid_amount), r.payment_status, r.guest_name, r.created_at]),
      );
    }
    if (kind === 'payments') {
      const rows = await this.prisma.payments.findMany({ where: { ...where, created_at: { gte: start, lt: end } }, orderBy: { created_at: 'asc' }, take: 50_000 });
      return table(
        ['id', 'status', 'method', 'provider', 'amount_som', 'refunded_som', 'commission_som', 'club_amount_som', 'paid_at', 'booking_id', 'shift_id'],
        rows.map((r) => [r.id, r.status, r.method, r.provider, som(r.amount), som(r.refunded_amount), som(r.commission_amount), som(r.club_amount), r.paid_at, r.booking_id, r.shift_id]),
      );
    }
    const rows = await this.prisma.cash_shifts.findMany({ where: { ...where, opened_at: { gte: start, lt: end } }, orderBy: { opened_at: 'asc' } });
    return table(
      ['id', 'status', 'opened_at', 'closed_at', 'opening_cash_som', 'expected_cash_som', 'counted_cash_som', 'difference_som', 'operator_id', 'note'],
      rows.map((r) => [r.id, r.status, r.opened_at, r.closed_at, som(r.opening_cash), som(r.expected_cash), som(r.closing_cash_counted), som(r.difference), r.operator_id, r.note]),
    );
  }
}
