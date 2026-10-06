import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { CancellationPolicy, policyFrom, refundPercent } from '../../common/domain/price-engine';
import { bestGroup } from '../../common/domain/seat-groups';
import { isWithinHours, openIntervals, WorkingHours } from '../../common/domain/working-hours';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { bookingCode, maskPhone, signQr } from '../../common/utils/codes';
import { fmtMoney, fmtWhen } from '../../common/utils/format';
import { uuidv7 } from '../../common/utils/id';
import { RealtimeService } from '../realtime/realtime.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { bookingSettings, BookingSettings } from '../clubs/branches.service';
import { EntitlementsService } from '../clubs/entitlements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FinanceService } from '../payments/finance.service';
import { can, scopeFilter, scopeWhere } from '../rbac/access';
import { Grant, RbacService } from '../rbac/rbac.service';
import { SettingsService } from '../settings/settings.service';
import { AvailabilityQuery, BookingListQuery, CreateBookingDto, RescheduleDto, SlotsQuery } from './dto/bookings.dto';
import { PricingService, PromoResult } from './pricing.service';

type Tx = Prisma.TransactionClient;
export const LIVE_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE'];
const EXCLUSION = /booking_items_no_overlap|23P01|conflicting key value violates exclusion constraint/;

export interface Caller {
  id: string;
  grants: Grant[];
}

export type BranchCtx = Awaited<ReturnType<BookingsService['branchCtx']>>;

/** Bron yaratilgan paytdagi siyosat (price_snapshot) — klub keyin o'zgartirsa ham mijozga ko'rsatilgani amal qiladi. */
function bookingPolicy(b: { price_snapshot: Prisma.JsonValue | null }, current: CancellationPolicy): CancellationPolicy {
  const snap = (b.price_snapshot as { cancellation_policy?: CancellationPolicy } | null)?.cancellation_policy;
  return snap?.rules ? snap : current;
}

@Injectable()
export class BookingsService {
  private readonly log = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly entitlements: EntitlementsService,
    private readonly rbac: RbacService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------- Kontekst va tekshiruvlar ----------

  async branchCtx(branchId: string, opts: { requireActive: boolean }) {
    const branch = await this.prisma.branches.findFirst({ where: { id: branchId, deleted_at: null }, include: { club: true } });
    if (!branch) throw new AppException('NOT_FOUND', 'Branch not found');
    if (opts.requireActive && (branch.club.status !== 'ACTIVE' || branch.status !== 'ACTIVE' || branch.club.deleted_at)) {
      throw new AppException('CLUB_NOT_ACTIVE', 'Club or branch is not accepting bookings');
    }
    const exceptions = await this.prisma.branch_hours_exceptions.findMany({ where: { branch_id: branchId, date: { gte: new Date(Date.now() - 2 * 86400_000) } } });
    const settings = bookingSettings(branch);
    const policy = policyFrom(branch.club.cancellation_policy);
    const clubSettings = (branch.club.settings ?? {}) as { allow_pay_at_club?: boolean };
    return { branch, club: branch.club, exceptions, settings, policy, allowPayAtClub: clubSettings.allow_pay_at_club !== false };
  }

  private validateTime(ctx: BranchCtx, start: Date, duration: number, staff: boolean) {
    const s = ctx.settings;
    const local = DateTime.fromJSDate(start, { zone: ctx.branch.timezone });
    if (!staff && (local.minute % s.slot_minutes !== 0 || local.second !== 0)) {
      throw new AppException('VALIDATION_ERROR', `start_at must align to ${s.slot_minutes}-minute slots`, { slot_minutes: s.slot_minutes });
    }
    if (duration < (ctx.club.min_booking_minutes ?? 15) && !staff) {
      throw new AppException('BOOKING_TOO_EARLY', 'Duration is below the club minimum', { min_minutes: ctx.club.min_booking_minutes });
    }
    const now = Date.now();
    if (start.getTime() < now + (staff ? -5 * 60_000 : s.min_advance_minutes * 60_000 - 60_000)) {
      throw new AppException('BOOKING_TOO_EARLY', 'Start time is too soon or in the past', { min_advance_minutes: s.min_advance_minutes });
    }
    if (start.getTime() > now + s.max_advance_days * 86400_000) throw new AppException('BOOKING_TOO_LATE', 'Start time is too far ahead', { max_advance_days: s.max_advance_days });
    const end = new Date(start.getTime() + duration * 60_000);
    if (!isWithinHours(ctx.branch.working_hours as WorkingHours, ctx.exceptions, ctx.branch.timezone, start, end)) {
      throw new AppException('BOOKING_OUTSIDE_WORKING_HOURS', 'Branch is closed during the requested time');
    }
    return end;
  }

  /** Muddati o'tgan holdlarni EXPIRED qilish (bron yaratish va sweeper uchun). */
  async expireHolds(tx: Tx, filter?: { device_ids?: string[] }) {
    const expired = await tx.bookings.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        hold_expires_at: { lte: new Date() },
        ...(filter?.device_ids ? { items: { some: { device_id: { in: filter.device_ids }, active: true } } } : {}),
      },
      select: { id: true, customer_id: true, code: true, promotion_id: true },
    });
    for (const b of expired) {
      await tx.bookings.update({ where: { id: b.id }, data: { status: 'EXPIRED' } });
      await tx.booking_items.updateMany({ where: { booking_id: b.id }, data: { active: false } });
      await this.releasePromo(tx, b.id, b.promotion_id);
      await tx.booking_events.create({ data: { id: uuidv7(), booking_id: b.id, type: 'EXPIRED' } });
    }
    return expired;
  }

  private async releasePromo(tx: Tx, bookingId: string, promotionId: string | null) {
    if (!promotionId) return;
    const r = await tx.promotion_redemptions.deleteMany({ where: { booking_id: bookingId, promotion_id: promotionId } });
    if (r.count) await tx.promotions.update({ where: { id: promotionId }, data: { used_count: { decrement: 1 } } });
  }

  /** Oraliqda band qurilmalar: faol itemlar (muddati o'tgan holdlarsiz) va jonli sessiyalar. */
  async busy(tx: Tx, deviceIds: string[], start: Date, blockedEnd: Date, excludeBookingId?: string) {
    const items = await tx.booking_items.findMany({
      where: {
        device_id: { in: deviceIds },
        active: true,
        start_at: { lt: blockedEnd },
        blocked_until: { gt: start },
        ...(excludeBookingId ? { booking_id: { not: excludeBookingId } } : {}),
        NOT: { booking: { status: 'PENDING_PAYMENT', hold_expires_at: { lte: new Date() } } },
      },
      select: { device_id: true, booking: { select: { status: true } } },
    });
    const sessions = await tx.sessions.findMany({
      where: { device_id: { in: deviceIds }, status: { in: ['WAITING', 'ACTIVE', 'PAUSED'] }, ...(excludeBookingId ? { booking_id: { not: excludeBookingId } } : {}) },
      select: { device_id: true, expected_end_at: true, status: true },
    });
    const reserved = new Set(items.map((i) => i.device_id));
    const occupied = new Set(sessions.filter((s) => s.status === 'PAUSED' || !s.expected_end_at || s.expected_end_at > start).map((s) => s.device_id));
    return { reserved, occupied };
  }

  // ---------- Availability ----------

  async availability(branchId: string, q: AvailabilityQuery) {
    const ctx = await this.branchCtx(branchId, { requireActive: true });
    const start = new Date(q.start_at);
    const end = new Date(start.getTime() + q.duration * 60_000);
    const within = isWithinHours(ctx.branch.working_hours as WorkingHours, ctx.exceptions, ctx.branch.timezone, start, end);
    const devices = await this.prisma.devices.findMany({
      where: {
        branch_id: branchId, deleted_at: null, operational_status: { not: 'DISABLED' },
        ...(q.device_type ? { type: q.device_type } : {}), ...(q.room_id ? { room_id: q.room_id } : {}), ...(q.category_id ? { category_id: q.category_id } : {}),
      },
      orderBy: [{ position_order: 'asc' }, { name: 'asc' }],
      include: { room: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } },
    });
    const blockedEnd = new Date(end.getTime() + ctx.settings.buffer_minutes * 60_000);
    const { reserved, occupied } = await this.busy(this.prisma, devices.map((d) => d.id), start, blockedEnd);
    const tariffs = await this.pricing.tariffs(branchId);
    const result = devices.map((d) => {
      const status = d.operational_status !== 'ACTIVE' || !within ? 'UNAVAILABLE' : occupied.has(d.id) ? 'OCCUPIED' : reserved.has(d.id) ? 'RESERVED' : 'AVAILABLE';
      const pq = this.pricing.tryQuote(tariffs, d, start, end, ctx.branch.timezone);
      return {
        id: d.id, name: d.name, type: d.type, specs: d.specs, room: d.room, category: d.category, layout: d.layout, status,
        price_quote: pq ? { amount: pq.amount, tariff_id: pq.tariff_id, tariff_name: pq.tariff_name, segments: pq.segments } : null,
      };
    });
    const cats = new Map<string, { category_id: string; name: string; available_count: number; price_from: bigint | null }>();
    for (const d of result) {
      if (!d.category) continue;
      const c = cats.get(d.category.id) ?? { category_id: d.category.id, name: d.category.name, available_count: 0, price_from: null };
      if (d.status === 'AVAILABLE') c.available_count++;
      if (d.price_quote && (c.price_from === null || d.price_quote.amount < c.price_from)) c.price_from = d.price_quote.amount;
      cats.set(d.category.id, c);
    }
    const anyFree = result.some((d) => d.status === 'AVAILABLE');
    // O'rindiq sxemasi uchun xonalar: grid o'lchami, xona tarifi, bo'sh joylar soni
    const roomRows = await this.prisma.rooms.findMany({
      where: { branch_id: branchId, deleted_at: null, status: 'ACTIVE' },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, type: true, description: true, grid_cols: true, grid_rows: true, decor: true },
    });
    const rooms = roomRows.map((r) => {
      const inRoom = result.filter((d) => d.room?.id === r.id);
      const tariff = tariffs.find((tr) => tr.room_id === r.id);
      const prices = inRoom.map((d) => d.price_quote?.amount).filter((a): a is bigint => a != null);
      return {
        ...r,
        tariff: tariff ? { id: tariff.id, name: tariff.name, price_per_hour: tariff.price_per_hour } : null,
        price_from: prices.length ? prices.reduce((a, b) => (b < a ? b : a)) : null,
        total_count: inRoom.length,
        available_count: inRoom.filter((d) => d.status === 'AVAILABLE').length,
        // Do'stlar uchun: 2..5 kishiga eng yaxshi yonma-yon joylar
        together: Object.fromEntries(
          [2, 3, 4, 5].map((n) => [n, bestGroup(inRoom.filter((d) => d.status === 'AVAILABLE' && d.price_quote && d.layout).map((d) => ({ id: d.id, ...(d.layout as { x: number; y: number }) })), n)]),
        ),
      };
    });
    return {
      rooms,
      branch_id: branchId,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      within_working_hours: within,
      mode: { specific_device: ctx.settings.allow_specific_device, category: ctx.settings.allow_category_booking },
      hold_minutes: ctx.settings.hold_minutes,
      devices: result,
      categories: [...cats.values()],
      suggested_slots: anyFree ? [] : await this.suggest(ctx, devices.map((d) => d.id), start, q.duration),
    };
  }

  /** Bo'sh joy yo'q bo'lsa eng yaqin 3 ta muqobil vaqt (§6.8). */
  private async suggest(ctx: BranchCtx, deviceIds: string[], start: Date, duration: number) {
    const out: { start_at: string; available_count: number }[] = [];
    const step = ctx.settings.slot_minutes * 60_000;
    for (let k = 1; k <= 24 && out.length < 3; k++) {
      const s = new Date(start.getTime() + k * step);
      const e = new Date(s.getTime() + duration * 60_000);
      if (s.getTime() > Date.now() + ctx.settings.max_advance_days * 86400_000) break;
      if (!isWithinHours(ctx.branch.working_hours as WorkingHours, ctx.exceptions, ctx.branch.timezone, s, e)) continue;
      const { reserved, occupied } = await this.busy(this.prisma, deviceIds, s, new Date(e.getTime() + ctx.settings.buffer_minutes * 60_000));
      const free = deviceIds.filter((id) => !reserved.has(id) && !occupied.has(id)).length;
      if (free > 0) out.push({ start_at: s.toISOString(), available_count: free });
    }
    return out;
  }

  /** Kun bo'yicha slotlar: har slot uchun bo'sh qurilmalar soni (bron ekrani uchun). */
  async slots(branchId: string, q: SlotsQuery) {
    const ctx = await this.branchCtx(branchId, { requireActive: true });
    const tz = ctx.branch.timezone;
    const dayStart = DateTime.fromISO(q.date, { zone: tz }).startOf('day');
    const dayEnd = dayStart.plus({ days: 1 });
    const own = q.exclude_booking_id ? await this.prisma.booking_items.findMany({ where: { booking_id: q.exclude_booking_id, active: true, booking: { branch_id: branchId } }, select: { device_id: true } }) : null;
    const devices = await this.prisma.devices.findMany({
      where: { branch_id: branchId, deleted_at: null, operational_status: 'ACTIVE', ...(q.device_type ? { type: q.device_type } : {}), ...(own ? { id: { in: own.map((o) => o.device_id) } } : {}) },
      select: { id: true },
    });
    const ids = devices.map((d) => d.id);
    const items = await this.prisma.booking_items.findMany({
      where: {
        device_id: { in: ids }, active: true, ...(q.exclude_booking_id ? { booking_id: { not: q.exclude_booking_id } } : {}), start_at: { lt: dayEnd.plus({ minutes: q.duration }).toJSDate() }, blocked_until: { gt: dayStart.toJSDate() },
        NOT: { booking: { status: 'PENDING_PAYMENT', hold_expires_at: { lte: new Date() } } },
      },
      select: { device_id: true, start_at: true, blocked_until: true },
    });
    const sessions = await this.prisma.sessions.findMany({ where: { device_id: { in: ids }, status: { in: ['ACTIVE', 'PAUSED', 'WAITING'] } }, select: { device_id: true, expected_end_at: true } });
    const intervals = openIntervals(ctx.branch.working_hours as WorkingHours, ctx.exceptions, tz, dayStart.toJSDate(), dayEnd.toJSDate());
    const step = ctx.settings.slot_minutes;
    const now = Date.now() + ctx.settings.min_advance_minutes * 60_000;
    const out: { start_at: string; available_count: number }[] = [];
    for (let t = dayStart; t < dayEnd; t = t.plus({ minutes: step })) {
      const s = t.toMillis();
      const e = s + q.duration * 60_000;
      if (s < now) continue;
      if (!intervals.some(([a, b]) => a <= s && e <= b)) continue;
      const blocked = e + ctx.settings.buffer_minutes * 60_000;
      const busy = new Set([
        ...items.filter((i) => i.start_at.getTime() < blocked && i.blocked_until.getTime() > s).map((i) => i.device_id),
        ...sessions.filter((x) => !x.expected_end_at || x.expected_end_at.getTime() > s).map((x) => x.device_id),
      ]);
      out.push({ start_at: new Date(s).toISOString(), available_count: ids.filter((id) => !busy.has(id)).length });
    }
    return { date: q.date, timezone: tz, slot_minutes: step, total_devices: ids.length, slots: out };
  }

  // ---------- Yaratish (§7.2) ----------

  async create(dto: CreateBookingDto, caller: Caller, idempotencyKey?: string) {
    const ctx = await this.branchCtx(dto.branch_id, { requireActive: true });
    const staff = can(caller.grants, 'bookings.create', { club_id: ctx.club.id, branch_id: ctx.branch.id });
    const source = dto.source === 'PHONE' && staff ? 'PHONE' : dto.source === 'WEB' ? 'WEB' : 'APP';
    const isPhone = source === 'PHONE';
    if (!(await this.entitlements.canAcceptBookings(ctx.club.id))) throw new AppException('CLUB_NOT_ACTIVE', 'Club subscription is not active');
    const start = new Date(dto.start_at);
    const end = this.validateTime(ctx, start, dto.duration_minutes, isPhone);
    const customerId = isPhone ? null : caller.id;

    if (customerId) {
      const user = await this.prisma.users.findUniqueOrThrow({ where: { id: customerId } });
      if (user.booking_blocked_until && user.booking_blocked_until > new Date()) {
        throw new AppException('CUSTOMER_BOOKING_BLOCKED', 'Booking is temporarily restricted', { until: user.booking_blocked_until.toISOString() });
      }
      const holds = await this.prisma.bookings.count({ where: { customer_id: customerId, status: 'PENDING_PAYMENT', hold_expires_at: { gt: new Date() } } });
      if (holds >= ((await this.settings.get<number>('booking.max_parallel_holds')) ?? 2)) throw new AppException('CONFLICT', 'Too many unpaid bookings', { reason: 'MAX_HOLDS' });
      const overlap = await this.prisma.bookings.count({ where: { customer_id: customerId, status: { in: LIVE_STATUSES }, start_at: { lt: end }, end_at: { gt: start }, NOT: { status: 'PENDING_PAYMENT', hold_expires_at: { lte: new Date() } } } });
      if (overlap) throw new AppException('CONFLICT', 'You already have a booking at this time', { reason: 'OVERLAP' });
    }
    for (const it of dto.items) {
      if (!it.device_id && !it.category_id) throw new AppException('VALIDATION_ERROR', 'Each item needs device_id or category_id', { field: 'items' });
      if (it.device_id && !ctx.settings.allow_specific_device && !staff) throw new AppException('VALIDATION_ERROR', 'This branch books by category only', { field: 'items' });
      if (!it.device_id && !ctx.settings.allow_category_booking) throw new AppException('VALIDATION_ERROR', 'This branch books specific devices only', { field: 'items' });
    }
    if (new Set(dto.items.filter((i) => i.device_id).map((i) => i.device_id)).size !== dto.items.filter((i) => i.device_id).length) {
      throw new AppException('VALIDATION_ERROR', 'Duplicate devices', { field: 'items' });
    }

    const tariffs = await this.pricing.tariffs(ctx.branch.id);
    const blockedEnd = new Date(end.getTime() + ctx.settings.buffer_minutes * 60_000);
    const tried = new Set<string>();

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const booking = await this.prisma.$transaction(async (tx) => {
          const devices = await tx.devices.findMany({ where: { branch_id: ctx.branch.id, deleted_at: null, operational_status: 'ACTIVE' }, orderBy: [{ position_order: 'asc' }, { name: 'asc' }] });
          await this.expireHolds(tx, { device_ids: devices.map((d) => d.id) });
          const { reserved, occupied } = await this.busy(tx, devices.map((d) => d.id), start, blockedEnd);
          const taken = new Set<string>();
          const chosen = dto.items.map((it) => {
            if (it.device_id) {
              const d = devices.find((x) => x.id === it.device_id);
              if (!d) throw new AppException('DEVICE_NOT_AVAILABLE', 'Device is not available', { device_id: it.device_id });
              if (reserved.has(d.id) || occupied.has(d.id)) throw new AppException('BOOKING_SLOT_TAKEN', 'This device is already booked for that time', { device_id: d.id });
              taken.add(d.id);
              return { device: d, requested_category_id: null as string | null };
            }
            // Kategoriya: birinchi bo'sh qurilma (oldingi urinishda band bo'lganlar tashlab ketiladi)
            const d = devices.find((x) => x.category_id === it.category_id && !reserved.has(x.id) && !occupied.has(x.id) && !taken.has(x.id) && !tried.has(x.id));
            if (!d) throw new AppException('BOOKING_SLOT_TAKEN', 'No free device in this category', { category_id: it.category_id });
            taken.add(d.id);
            tried.add(d.id);
            return { device: d, requested_category_id: it.category_id! };
          });
          const quotes = chosen.map((c) => ({ ...c, q: this.pricing.quoteDevice(tariffs, c.device, start, end, ctx.branch.timezone) }));
          const subtotal = quotes.reduce((s, x) => s + x.q.amount, 0n);
          let promo: PromoResult | null = null;
          if (dto.promo_code) {
            promo = await this.pricing.promo(dto.promo_code, {
              club_id: ctx.club.id, branch_id: ctx.branch.id, user_id: customerId, subtotal, device_types: quotes.map((x) => x.device.type), start,
              weekday: DateTime.fromJSDate(start, { zone: ctx.branch.timezone }).weekday,
            });
          }
          const discount = promo?.discount ?? 0n;
          const total = subtotal - discount;
          const payLater = isPhone || dto.payment_mode === 'AT_CLUB';
          if (dto.payment_mode === 'AT_CLUB' && !ctx.allowPayAtClub && !staff) throw new AppException('VALIDATION_ERROR', 'This club requires online payment', { field: 'payment_mode' });
          const status = total === 0n || payLater ? 'CONFIRMED' : 'PENDING_PAYMENT';
          const id = uuidv7();
          const b = await tx.bookings.create({
            data: {
              id, code: bookingCode(), customer_id: customerId, guest_name: dto.guest_name, guest_phone: dto.guest_phone, club_id: ctx.club.id, branch_id: ctx.branch.id,
              source, status, start_at: start, end_at: end, duration_minutes: dto.duration_minutes, subtotal_amount: subtotal, discount_amount: discount, total_amount: total,
              payment_status: total === 0n ? 'PAID' : 'UNPAID', promotion_id: promo?.promotion_id,
              hold_expires_at: status === 'PENDING_PAYMENT' ? new Date(Date.now() + ctx.settings.hold_minutes * 60_000) : null,
              notes: dto.notes, idempotency_key: idempotencyKey ?? null,
              price_snapshot: {
                promo: promo ? { code: promo.code, discount: Number(discount), funded_by: promo.funded_by } : null,
                payment_mode: payLater ? 'AT_CLUB' : 'ONLINE',
                cancellation_policy: ctx.policy as unknown as Prisma.InputJsonValue,
              },
            },
          });
          await tx.booking_items.createMany({
            data: quotes.map((x) => ({
              id: uuidv7(), booking_id: id, club_id: ctx.club.id, branch_id: ctx.branch.id, device_id: x.device.id, category_id: x.device.category_id,
              requested_category_id: x.requested_category_id, start_at: start, end_at: end, blocked_until: blockedEnd, active: true, price_amount: x.q.amount,
              tariff_id: x.q.tariff_id, price_breakdown: { segments: x.q.segments, rounding: 'CEIL', currency: 'UZS' } as unknown as Prisma.InputJsonValue,
            })),
          });
          if (promo) {
            await tx.promotion_redemptions.create({ data: { id: uuidv7(), promotion_id: promo.promotion_id, user_id: customerId, booking_id: id, discount_amount: discount } });
            await tx.promotions.update({ where: { id: promo.promotion_id }, data: { used_count: { increment: 1 } } });
          }
          await tx.booking_events.create({ data: { id: uuidv7(), booking_id: id, type: 'CREATED', actor_id: caller.id, data: { source, status } } });
          if (isPhone) await this.audit.log({ actor_id: caller.id, club_id: ctx.club.id, action: 'booking.create_phone', target_type: 'booking', target_id: id }, tx);
          return { ...b, devices: quotes.map((x) => x.device.name) };
        });
        const when = fmtWhen(booking.start_at, ctx.branch.timezone);
        await this.notifications.notify([booking.customer_id], booking.status === 'CONFIRMED' ? 'BOOKING_CONFIRMED' : 'BOOKING_CREATED', { code: booking.code, club: ctx.club.name, when, minutes: ctx.settings.hold_minutes }, { booking_id: booking.id });
        if (booking.status === 'CONFIRMED') await this.notifications.notifyClubStaff(ctx.club.id, ctx.branch.id, 'NEW_BOOKING', { code: booking.code, when, devices: booking.devices.join(', ') }, { booking_id: booking.id });
        this.realtime.branch(ctx.branch.id, 'booking.created', { booking_id: booking.id, status: booking.status });
        return this.detail(booking.id);
      } catch (e) {
        if (e instanceof AppException) {
          if (e.code === 'BOOKING_SLOT_TAKEN' && dto.items.some((i) => !i.device_id) && attempt < 2) continue;
          throw e;
        }
        if (EXCLUSION.test(String((e as Error).message))) {
          if (dto.items.some((i) => !i.device_id) && attempt < 2) continue;
          throw new AppException('BOOKING_SLOT_TAKEN', 'This time slot was just taken');
        }
        if ((e as { code?: string }).code === 'P2002' && idempotencyKey) {
          const existing = await this.prisma.bookings.findFirst({ where: { customer_id: customerId, idempotency_key: idempotencyKey } });
          if (existing) return this.detail(existing.id);
        }
        throw e;
      }
    }
    throw new AppException('BOOKING_SLOT_TAKEN', 'This time slot was just taken');
  }

  // ---------- O'qish ----------

  async detail(id: string) {
    const b = await this.prisma.bookings.findUnique({ where: { id }, include: { items: { orderBy: { created_at: 'asc' } } } });
    if (!b) throw new AppException('NOT_FOUND', 'Booking not found');
    const [branch, clubPay, devices, payments, session, review] = await Promise.all([
      this.prisma.branches.findUnique({ where: { id: b.branch_id }, select: { id: true, name: true, slug: true, address: true, latitude: true, longitude: true, timezone: true, phone: true, booking_settings: true, club: { select: { id: true, name: true, slug: true, logo_url: true, phone: true } } } }),
      this.prisma.clubs.findUnique({ where: { id: b.club_id }, select: { cancellation_policy: true, transfer_card_number: true, transfer_card_holder: true } }),
      this.prisma.devices.findMany({ where: { id: { in: b.items.map((i) => i.device_id) } }, select: { id: true, name: true, type: true, room: { select: { name: true } } } }),
      this.prisma.payments.findMany({ where: { booking_id: id }, orderBy: { created_at: 'asc' }, select: { id: true, amount: true, method: true, provider: true, provider_payload: true, status: true, paid_at: true, refunded_amount: true, failed_reason: true, created_at: true } }),
      this.prisma.sessions.findFirst({ where: { booking_id: id }, orderBy: { created_at: 'desc' } }),
      this.prisma.reviews.findUnique({ where: { booking_id: id }, select: { id: true, rating: true, text: true, reply_text: true, replied_at: true, status: true, created_at: true } }),
    ]);
    const byId = new Map(devices.map((d) => [d.id, d]));
    const s = branch ? bookingSettings(branch) : null;
    const amountDue = b.total_amount - b.paid_amount > 0n && !['CANCELLED', 'EXPIRED'].includes(b.status) ? b.total_amount - b.paid_amount : 0n;
    const policy = bookingPolicy(b, policyFrom(clubPay?.cancellation_policy));
    const cancellable = ['PENDING_PAYMENT', 'CONFIRMED'].includes(b.status);
    const percentNow = cancellable ? refundPercent(policy, b.start_at, new Date()) : null;
    // Kartaga o'tkazma: karta faqat to'lanmagan bron uchun ko'rsatiladi
    const pendingTransfer = payments.find((p) => p.method === 'CARD_TRANSFER' && p.status === 'PROCESSING') ?? null;
    const lastRejected = [...payments].reverse().find((p) => p.method === 'CARD_TRANSFER' && p.status === 'FAILED') ?? null;
    const transfer = amountDue > 0n && clubPay?.transfer_card_number && b.customer_id && ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE'].includes(b.status)
      ? { card_number: clubPay.transfer_card_number, card_holder: clubPay.transfer_card_holder, amount: amountDue, pending: pendingTransfer, rejected: pendingTransfer ? null : lastRejected }
      : null;
    return {
      ...b,
      amount_due: amountDue,
      branch,
      club: branch?.club,
      cancellation_policy: policy,
      refund_preview: percentNow === null ? null : { percent: percentNow, amount: (b.paid_amount * BigInt(percentNow)) / 100n },
      transfer,
      items: b.items.map((i) => ({ ...i, device: byId.get(i.device_id) ?? null })),
      payments,
      session,
      review: review ? { ...review, can_edit: Date.now() - review.created_at.getTime() <= 24 * 3600_000 } : null,
      // O'tkazma tekshirilayotganda mijoz bekor qila olmaydi (pul yo'lda — avval klub tasdiqlaydi yoki rad etadi)
      can_cancel: cancellable && !pendingTransfer,
      can_reschedule: ['PENDING_PAYMENT', 'CONFIRMED'].includes(b.status) && b.reschedule_count < 2 && b.start_at.getTime() - Date.now() >= 60 * 60_000,
      can_review: b.status === 'COMPLETED' && !review,
      checkin_window: s ? { from: new Date(b.start_at.getTime() - s.early_checkin_minutes * 60_000).toISOString(), to: new Date(b.start_at.getTime() + s.grace_minutes * 60_000).toISOString() } : null,
      server_time: new Date().toISOString(),
    };
  }

  /** Customer o'z broni yoki shu scope'dagi xodim. Aks holda 404. */
  async loadFor(id: string, caller: Caller, permission: 'bookings.view' | 'bookings.cancel' | 'bookings.reschedule' | 'bookings.checkin') {
    const b = await this.prisma.bookings.findUnique({ where: { id } });
    if (!b) throw new AppException('NOT_FOUND', 'Booking not found');
    const staff = can(caller.grants, permission, { club_id: b.club_id, branch_id: b.branch_id });
    if (!staff && b.customer_id !== caller.id) throw new AppException('NOT_FOUND', 'Booking not found');
    return { booking: b, staff };
  }

  async get(id: string, caller: Caller) {
    const { staff } = await this.loadFor(id, caller, 'bookings.view');
    const d = await this.detail(id);
    if (!staff) return d;
    const customer = d.customer_id ? await this.prisma.users.findUnique({ where: { id: d.customer_id }, select: { id: true, phone: true, first_name: true, last_name: true, no_show_count: true } }) : null;
    const fullPhone = caller.grants.some((g) => ['SUPER_ADMIN', 'CLUB_OWNER', 'CLUB_ADMIN', 'BRANCH_ADMIN'].includes(g.role));
    return { ...d, customer: customer ? { ...customer, phone: fullPhone ? customer.phone : maskPhone(customer.phone) } : null };
  }

  async list(q: BookingListQuery, caller: Caller) {
    const staffMode = q.staff === 'true';
    const now = new Date();
    let where: Prisma.bookingsWhereInput;
    if (staffMode) {
      const f = scopeFilter(caller.grants, 'bookings.view');
      if (!f.platform && !f.clubIds.length && !f.branchIds.length) throw new AppException('FORBIDDEN', 'Permission denied');
      where = { ...scopeWhere(f), ...(q.club_id ? { club_id: q.club_id } : {}), ...(q.branch_id ? { branch_id: q.branch_id } : {}) } as Prisma.bookingsWhereInput;
      if (q.q) where.OR = [{ code: { contains: q.q.toUpperCase() } }, { guest_name: { contains: q.q, mode: 'insensitive' } }, { guest_phone: { contains: q.q } }];
    } else {
      where = { customer_id: caller.id };
    }
    if (q.status === 'UPCOMING') where = { ...where, status: { in: LIVE_STATUSES }, end_at: { gt: now } };
    else if (q.status === 'PAST') where = { ...where, OR: [{ status: { in: ['COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW'] } }, { end_at: { lte: now } }] };
    else if (q.status) where = { ...where, status: q.status };
    if (q.from || q.to) where = { ...where, start_at: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } };
    const [rows, total] = await Promise.all([
      this.prisma.bookings.findMany({
        where,
        orderBy: { start_at: q.status === 'UPCOMING' ? 'asc' : 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { items: { select: { device_id: true, price_amount: true } } },
      }),
      this.prisma.bookings.count({ where }),
    ]);
    const deviceIds = [...new Set(rows.flatMap((r) => r.items.map((i) => i.device_id)))];
    const branchIds = [...new Set(rows.map((r) => r.branch_id))];
    const customerIds = [...new Set(rows.map((r) => r.customer_id).filter((x): x is string => !!x))];
    const [devices, branches, customers] = await Promise.all([
      this.prisma.devices.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true, type: true } }),
      this.prisma.branches.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true, address: true, timezone: true, club: { select: { id: true, name: true, logo_url: true } } } }),
      staffMode ? this.prisma.users.findMany({ where: { id: { in: customerIds } }, select: { id: true, phone: true, first_name: true, last_name: true } }) : Promise.resolve([]),
    ]);
    const dById = new Map(devices.map((d) => [d.id, d]));
    const bById = new Map(branches.map((b) => [b.id, b]));
    const cById = new Map(customers.map((c) => [c.id, c]));
    const fullPhone = caller.grants.some((g) => ['SUPER_ADMIN', 'CLUB_OWNER', 'CLUB_ADMIN', 'BRANCH_ADMIN'].includes(g.role));
    return new Paginated(
      rows.map((r) => {
        const c = r.customer_id ? cById.get(r.customer_id) : undefined;
        return {
          ...r,
          items: undefined,
          devices: r.items.map((i) => dById.get(i.device_id)).filter(Boolean),
          branch: bById.get(r.branch_id) ?? null,
          ...(staffMode ? { customer: c ? { ...c, phone: fullPhone ? c.phone : maskPhone(c.phone) } : null } : {}),
        };
      }),
      { page: q.page, limit: q.limit, total },
    );
  }

  async timeline(id: string, caller: Caller) {
    const { staff } = await this.loadFor(id, caller, 'bookings.view');
    if (!staff) throw new AppException('NOT_FOUND', 'Booking not found');
    return this.prisma.booking_events.findMany({ where: { booking_id: id }, orderBy: { at: 'asc' } });
  }

  async qr(id: string, caller: Caller) {
    const { booking } = await this.loadFor(id, caller, 'bookings.view');
    if (!['CONFIRMED', 'CHECKED_IN', 'ACTIVE', 'PENDING_PAYMENT'].includes(booking.status)) throw new AppException('CONFLICT', 'QR is not available for this booking');
    const secret = this.config.getOrThrow<string>('QR_HMAC_SECRET');
    return { code: booking.code, qr_payload: signQr(booking.id, booking.end_at, secret), expires_at: booking.end_at.toISOString() };
  }

  // ---------- Bekor qilish, ko'chirish, no-show ----------

  async cancel(id: string, caller: Caller, reason?: string) {
    const { booking: b, staff } = await this.loadFor(id, caller, 'bookings.cancel');
    const allowed = staff ? ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN'] : ['PENDING_PAYMENT', 'CONFIRMED'];
    if (!allowed.includes(b.status)) throw new AppException('BOOKING_NOT_CANCELLABLE', `Cannot cancel a ${b.status} booking`);
    if (!staff && (await this.prisma.payments.count({ where: { booking_id: id, method: 'CARD_TRANSFER', status: 'PROCESSING' } }))) {
      throw new AppException('BOOKING_NOT_CANCELLABLE', 'Transfer is awaiting club confirmation', { reason: 'TRANSFER_PENDING' });
    }
    const ctx = await this.branchCtx(b.branch_id, { requireActive: false });
    // Xodim bekor qilsa — to'liq qaytariladi; mijoz — cancellation_policy bo'yicha
    const policy = bookingPolicy(b, ctx.policy);
    const percent = staff && b.customer_id !== caller.id ? 100 : refundPercent(policy, b.start_at, new Date());
    const refundable = (b.paid_amount * BigInt(percent)) / 100n;
    const result = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.bookings.findUniqueOrThrow({ where: { id } });
      if (!allowed.includes(fresh.status)) throw new AppException('BOOKING_NOT_CANCELLABLE', `Cannot cancel a ${fresh.status} booking`);
      await tx.bookings.update({ where: { id }, data: { status: 'CANCELLED', cancelled_at: new Date(), cancelled_by: caller.id, cancellation_reason: reason, hold_expires_at: null } });
      await tx.booking_items.updateMany({ where: { booking_id: id }, data: { active: false } });
      await this.releasePromo(tx, id, b.promotion_id);
      const refunded = await this.finance.refundBooking(tx, id, refundable, reason ?? 'Booking cancelled', caller.id, { percent, policy });
      await tx.booking_events.create({ data: { id: uuidv7(), booking_id: id, type: 'CANCELLED', actor_id: caller.id, data: { reason, refund_percent: percent, refunded: Number(refunded) } } });
      if (staff) await this.audit.log({ actor_id: caller.id, club_id: b.club_id, action: 'booking.cancel', target_type: 'booking', target_id: id, new_value: { reason, refunded: Number(refunded) } }, tx);
      return refunded;
    });
    await this.notifications.notify([b.customer_id], 'BOOKING_CANCELLED', { code: b.code, refund: fmtMoney(result) }, { booking_id: id });
    this.realtime.branch(b.branch_id, 'booking.cancelled', { booking_id: id });
    return { ...(await this.detail(id)), refund_percent: percent, refunded_amount: result };
  }

  /** Cancel hook — qurilma MAINTENANCE bo'lganda (devices moduli). */
  async cancelMany(ids: string[], reason: string, actorId: string) {
    for (const id of ids) {
      const b = await this.prisma.bookings.findUnique({ where: { id } });
      if (!b || !LIVE_STATUSES.includes(b.status)) continue;
      await this.prisma.$transaction(async (tx) => {
        await tx.bookings.update({ where: { id }, data: { status: 'CANCELLED', cancelled_at: new Date(), cancelled_by: actorId, cancellation_reason: reason } });
        await tx.booking_items.updateMany({ where: { booking_id: id }, data: { active: false } });
        await this.releasePromo(tx, id, b.promotion_id);
        await this.finance.refundBooking(tx, id, b.paid_amount, reason, actorId);
        await tx.booking_events.create({ data: { id: uuidv7(), booking_id: id, type: 'CANCELLED', actor_id: actorId, data: { reason } } });
      });
      await this.notifications.notify([b.customer_id], 'BOOKING_CANCELLED', { code: b.code, refund: fmtMoney(b.paid_amount) }, { booking_id: id });
    }
  }

  async reschedule(id: string, caller: Caller, dto: RescheduleDto) {
    const { booking: b, staff } = await this.loadFor(id, caller, 'bookings.reschedule');
    if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(b.status)) throw new AppException('CONFLICT', `Cannot reschedule a ${b.status} booking`);
    if (!staff && b.reschedule_count >= 2) throw new AppException('CONFLICT', 'Reschedule limit reached', { reason: 'LIMIT' });
    if (!staff && b.start_at.getTime() - Date.now() < 60 * 60_000) throw new AppException('CONFLICT', 'Too late to reschedule', { reason: 'TOO_LATE' });
    const ctx = await this.branchCtx(b.branch_id, { requireActive: true });
    const start = new Date(dto.start_at);
    const duration = dto.duration_minutes ?? b.duration_minutes;
    const end = this.validateTime(ctx, start, duration, staff);
    const blockedEnd = new Date(end.getTime() + ctx.settings.buffer_minutes * 60_000);
    const items = await this.prisma.booking_items.findMany({ where: { booking_id: id } });
    if (dto.device_id && items.length !== 1) throw new AppException('VALIDATION_ERROR', 'device_id can only be changed for single-device bookings', { field: 'device_id' });
    const tariffs = await this.pricing.tariffs(b.branch_id);
    try {
      await this.prisma.$transaction(async (tx) => {
        const deviceIds = dto.device_id ? [dto.device_id] : items.map((i) => i.device_id);
        const devices = await tx.devices.findMany({ where: { id: { in: deviceIds }, branch_id: b.branch_id, deleted_at: null, operational_status: 'ACTIVE' } });
        if (devices.length !== deviceIds.length) throw new AppException('DEVICE_NOT_AVAILABLE', 'Device is not available');
        await this.expireHolds(tx, { device_ids: deviceIds });
        const { reserved, occupied } = await this.busy(tx, deviceIds, start, blockedEnd, id);
        if (deviceIds.some((d) => reserved.has(d) || occupied.has(d))) throw new AppException('BOOKING_SLOT_TAKEN', 'The new time is not available');
        let subtotal = 0n;
        for (const [i, item] of items.entries()) {
          const device = devices.find((d) => d.id === (dto.device_id ?? item.device_id))!;
          const q = this.pricing.quoteDevice(tariffs, device, start, end, ctx.branch.timezone);
          subtotal += q.amount;
          await tx.booking_items.update({
            where: { id: item.id },
            data: { device_id: device.id, start_at: start, end_at: end, blocked_until: blockedEnd, price_amount: q.amount, tariff_id: q.tariff_id, price_breakdown: { segments: q.segments } as unknown as Prisma.InputJsonValue },
          });
          void i;
        }
        const discount = b.discount_amount > subtotal ? subtotal : b.discount_amount;
        const total = subtotal - discount;
        await tx.bookings.update({ where: { id }, data: { start_at: start, end_at: end, duration_minutes: duration, subtotal_amount: subtotal, discount_amount: discount, total_amount: total, reschedule_count: { increment: 1 } } });
        // Narx tushsa farq qaytariladi; oshsa amount_due qoladi
        if (b.paid_amount > total) await this.finance.refundBooking(tx, id, b.paid_amount - total, 'Reschedule price difference', caller.id);
        else await this.finance.syncBookingPayment(tx, id);
        await tx.booking_events.create({ data: { id: uuidv7(), booking_id: id, type: 'RESCHEDULED', actor_id: caller.id, data: { from: b.start_at.toISOString(), to: start.toISOString(), device_id: dto.device_id ?? null } } });
      });
    } catch (e) {
      if (EXCLUSION.test(String((e as Error).message))) throw new AppException('BOOKING_SLOT_TAKEN', 'The new time is not available');
      throw e;
    }
    const d = await this.detail(id);
    this.realtime.branch(d.branch_id, 'booking.updated', { booking_id: id });
    return d;
  }

  async markNoShow(tx: Tx, b: { id: string; customer_id: string | null; paid_amount: bigint; promotion_id: string | null; code: string; price_snapshot: Prisma.JsonValue | null }, current: CancellationPolicy, actorId: string | null) {
    await tx.bookings.update({ where: { id: b.id }, data: { status: 'NO_SHOW', no_show_marked_at: new Date() } });
    await tx.booking_items.updateMany({ where: { booking_id: b.id }, data: { active: false } });
    const policy = bookingPolicy(b, current);
    const percent = policy.no_show_refund_percent ?? 0;
    const refund = (b.paid_amount * BigInt(percent)) / 100n;
    if (refund > 0n) await this.finance.refundBooking(tx, b.id, refund, 'No-show refund', actorId, { percent, policy });
    await tx.booking_events.create({ data: { id: uuidv7(), booking_id: b.id, type: 'NO_SHOW', actor_id: actorId } });
    if (b.customer_id) {
      const limit = (await this.settings.get<number>('booking.no_show_limit')) ?? 3;
      const windowDays = (await this.settings.get<number>('booking.no_show_window_days')) ?? 30;
      const blockDays = (await this.settings.get<number>('booking.block_days')) ?? 14;
      await tx.users.update({ where: { id: b.customer_id }, data: { no_show_count: { increment: 1 } } });
      const recent = await tx.bookings.count({ where: { customer_id: b.customer_id, status: 'NO_SHOW', no_show_marked_at: { gte: new Date(Date.now() - windowDays * 86400_000) } } });
      if (recent >= limit) await tx.users.update({ where: { id: b.customer_id }, data: { booking_blocked_until: new Date(Date.now() + blockDays * 86400_000) } });
    }
  }

  async noShow(id: string, caller: Caller) {
    const { booking: b, staff } = await this.loadFor(id, caller, 'bookings.checkin');
    if (!staff) throw new AppException('NOT_FOUND', 'Booking not found');
    if (b.status !== 'CONFIRMED') throw new AppException('CONFLICT', `Cannot mark ${b.status} as no-show`);
    if (b.start_at > new Date()) throw new AppException('CONFLICT', 'Booking has not started yet');
    const ctx = await this.branchCtx(b.branch_id, { requireActive: false });
    await this.prisma.$transaction(async (tx) => {
      await this.markNoShow(tx, b, ctx.policy, caller.id);
      await this.audit.log({ actor_id: caller.id, club_id: b.club_id, action: 'booking.no_show', target_type: 'booking', target_id: id }, tx);
    });
    await this.notifications.notify([b.customer_id], 'NO_SHOW_WARNING', { code: b.code }, { booking_id: id });
    const d = await this.detail(id);
    this.realtime.branch(d.branch_id, 'booking.updated', { booking_id: id, status: 'NO_SHOW' });
    return d;
  }

  // ---------- Fon ishlari (§10): hold expiry va no-show sweeper ----------

  async sweep() {
    const expired = await this.prisma.$transaction((tx) => this.expireHolds(tx));
    for (const b of expired) await this.notifications.notify([b.customer_id], 'BOOKING_EXPIRED', { code: b.code }, { booking_id: b.id });

    const candidates = await this.prisma.bookings.findMany({ where: { status: 'CONFIRMED', start_at: { lt: new Date(Date.now() - 5 * 60_000) } }, take: 200 });
    const ctxCache = new Map<string, { settings: BookingSettings; policy: CancellationPolicy }>();
    for (const b of candidates) {
      let ctx = ctxCache.get(b.branch_id);
      if (!ctx) {
        const c = await this.branchCtx(b.branch_id, { requireActive: false });
        ctx = { settings: c.settings, policy: c.policy };
        ctxCache.set(b.branch_id, ctx);
      }
      if (!ctx.settings.auto_no_show) continue;
      if (b.start_at.getTime() + ctx.settings.grace_minutes * 60_000 > Date.now()) continue;
      await this.prisma.$transaction((tx) => this.markNoShow(tx, b, ctx!.policy, null));
      await this.notifications.notify([b.customer_id], 'NO_SHOW_WARNING', { code: b.code }, { booking_id: b.id });
      this.realtime.branch(b.branch_id, 'booking.updated', { booking_id: b.id, status: 'NO_SHOW' });
    }
    return { expired: expired.length };
  }

  async grantsOf(userId: string) {
    return this.rbac.grants(userId);
  }
}
