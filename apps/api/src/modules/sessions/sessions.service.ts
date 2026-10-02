import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { AppException } from '../../common/errors';
import { bookingCode, verifyQr } from '../../common/utils/codes';
import { fmtTime } from '../../common/utils/format';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BookingsService, Caller } from '../bookings/bookings.service';
import { PricingService } from '../bookings/pricing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FinanceService } from '../payments/finance.service';
import { assertCan, can } from '../rbac/access';
import { RealtimeService } from '../realtime/realtime.service';
import { ExtendDto, MoveDto, StopDto, WalkInDto } from './dto/sessions.dto';

type Tx = Prisma.TransactionClient;
const LIVE = ['WAITING', 'ACTIVE', 'PAUSED'];
const EXCLUSION = /booking_items_no_overlap|23P01|exclusion constraint/;
const UNIQUE_LIVE = /sessions_one_live_per_device/;
const OVERTIME_GRACE_MIN = 5;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly pricing: PricingService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Filial live board'i va mijozga event (docs/01-API.md §9). */
  private emitLive(s: { id: string; branch_id: string; device_id: string; customer_id: string | null; expected_end_at?: Date | null }, event: 'session.started' | 'session.updated' | 'session.ended') {
    const data = { session_id: s.id, device_id: s.device_id, expected_end_at: s.expected_end_at ?? null, server_time: new Date().toISOString() };
    this.realtime.branch(s.branch_id, event, data);
    this.realtime.branch(s.branch_id, 'device.status.changed', { device_id: s.device_id, session_id: s.id });
    this.realtime.user(s.customer_id, event, data);
  }

  private async load(id: string, caller: Caller, permission: 'sessions.view' | 'sessions.start' | 'sessions.stop' | 'sessions.pause' | 'sessions.extend' | 'sessions.move') {
    const s = await this.prisma.sessions.findUnique({ where: { id } });
    if (!s) throw new AppException('NOT_FOUND', 'Session not found');
    const staff = can(caller.grants, permission, { club_id: s.club_id, branch_id: s.branch_id });
    if (!staff && !(permission === 'sessions.view' && s.customer_id === caller.id)) throw new AppException('NOT_FOUND', 'Session not found');
    return s;
  }

  async view(id: string) {
    const s = await this.prisma.sessions.findUniqueOrThrow({ where: { id }, include: { charges: { orderBy: { created_at: 'asc' } } } });
    const [device, booking] = await Promise.all([
      this.prisma.devices.findUnique({ where: { id: s.device_id }, select: { id: true, name: true, type: true } }),
      s.booking_id ? this.prisma.bookings.findUnique({ where: { id: s.booking_id }, select: { id: true, code: true, total_amount: true, paid_amount: true, status: true, guest_name: true } }) : null,
    ]);
    const now = Date.now();
    const pausedExtra = s.status === 'PAUSED' && s.paused_at ? now - s.paused_at.getTime() : 0;
    const remaining = s.expected_end_at && ['ACTIVE', 'PAUSED'].includes(s.status) ? Math.round((s.expected_end_at.getTime() + pausedExtra - now) / 1000) : null;
    return { ...s, device, booking, remaining_seconds: remaining, amount_due: booking ? booking.total_amount - booking.paid_amount : 0n, server_time: new Date().toISOString() };
  }

  // ---------- Check-in ----------

  async checkIn(bookingId: string, caller: Caller, opts: { force?: boolean; start_session?: boolean }) {
    const { booking: b, staff } = await this.bookings.loadFor(bookingId, caller, 'bookings.checkin');
    if (!staff) throw new AppException('NOT_FOUND', 'Booking not found');
    if (b.status === 'CHECKED_IN') return opts.start_session ? this.startFromBooking(bookingId, caller) : this.bookings.detail(bookingId);
    if (b.status !== 'CONFIRMED') throw new AppException('CONFLICT', `Cannot check in a ${b.status} booking`, { status: b.status });
    const ctx = await this.bookings.branchCtx(b.branch_id, { requireActive: false });
    const now = Date.now();
    const from = b.start_at.getTime() - ctx.settings.early_checkin_minutes * 60_000;
    const to = b.start_at.getTime() + ctx.settings.grace_minutes * 60_000;
    if ((now < from || now > to) && !opts.force) {
      throw new AppException('BOOKING_CHECKIN_WINDOW_CLOSED', 'Outside the check-in window', { from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bookings.update({ where: { id: bookingId }, data: { status: 'CHECKED_IN', checked_in_at: new Date(), checked_in_by: caller.id } });
      await tx.booking_events.create({ data: { id: uuidv7(), booking_id: bookingId, type: 'CHECKED_IN', actor_id: caller.id, data: { forced: !!opts.force && (now < from || now > to) } } });
      await this.audit.log({ actor_id: caller.id, club_id: b.club_id, action: 'booking.checkin', target_type: 'booking', target_id: bookingId, new_value: { force: !!opts.force } }, tx);
    });
    this.realtime.branch(b.branch_id, 'booking.updated', { booking_id: bookingId, status: 'CHECKED_IN' });
    return opts.start_session ? this.startFromBooking(bookingId, caller) : this.bookings.detail(bookingId);
  }

  /** QR payload (gc1....) yoki bron kodi (GC-XXXXXX) bo'yicha. */
  async scan(payload: string, caller: Caller, startSession?: boolean) {
    let bookingId: string | null = null;
    if (payload.startsWith('gc1.')) {
      const v = verifyQr(payload, this.config.getOrThrow('QR_HMAC_SECRET'));
      if (!v) throw new AppException('VALIDATION_ERROR', 'Invalid or expired QR code', { field: 'qr_payload' });
      bookingId = v.booking_id;
    } else {
      const b = await this.prisma.bookings.findUnique({ where: { code: payload.trim().toUpperCase() } });
      bookingId = b?.id ?? null;
    }
    if (!bookingId) throw new AppException('NOT_FOUND', 'Booking not found');
    return this.checkIn(bookingId, caller, { start_session: startSession });
  }

  // ---------- Boshlash ----------

  async startFromBooking(bookingId: string, caller: Caller, deviceId?: string) {
    const b = await this.prisma.bookings.findUnique({ where: { id: bookingId }, include: { items: true } });
    if (!b) throw new AppException('NOT_FOUND', 'Booking not found');
    assertCan(caller.grants, 'sessions.start', { club_id: b.club_id, branch_id: b.branch_id });
    if (b.status === 'CONFIRMED') {
      await this.checkIn(bookingId, caller, { force: true });
    } else if (!['CHECKED_IN', 'ACTIVE'].includes(b.status)) {
      throw new AppException('CONFLICT', `Cannot start session for a ${b.status} booking`, { status: b.status });
    }
    const items = b.items.filter((i) => (deviceId ? i.device_id === deviceId : true) && i.active);
    if (!items.length) throw new AppException('NOT_FOUND', 'Booking item not found');
    const ctx = await this.bookings.branchCtx(b.branch_id, { requireActive: false });
    const created: string[] = [];
    for (const item of items) {
      const already = await this.prisma.sessions.findFirst({ where: { booking_item_id: item.id, status: { in: LIVE } } });
      if (already) {
        created.push(already.id);
        continue;
      }
      const device = await this.prisma.devices.findUniqueOrThrow({ where: { id: item.device_id } });
      if (device.operational_status !== 'ACTIVE') throw new AppException('DEVICE_NOT_AVAILABLE', `${device.name} is not available`, { device_id: device.id });
      const now = new Date();
      const duration = item.end_at.getTime() - item.start_at.getTime();
      let expectedEnd = item.end_at;
      try {
        const id = await this.prisma.$transaction(async (tx) => {
          // Erta yoki kech boshlansa — to'liq bron qilingan davomiylik beriladi (joy bo'sh bo'lsa)
          if (Math.abs(now.getTime() - item.start_at.getTime()) > 60_000) {
            const newEnd = new Date(now.getTime() + duration);
            try {
              await tx.$executeRaw`SAVEPOINT shift_item`;
              await tx.booking_items.update({ where: { id: item.id }, data: { start_at: now < item.start_at ? now : item.start_at, end_at: newEnd, blocked_until: new Date(newEnd.getTime() + ctx.settings.buffer_minutes * 60_000) } });
              await tx.$executeRaw`RELEASE SAVEPOINT shift_item`;
              expectedEnd = newEnd;
            } catch {
              await tx.$executeRaw`ROLLBACK TO SAVEPOINT shift_item`;
            }
          }
          const sid = uuidv7();
          await tx.sessions.create({
            data: { id: sid, club_id: b.club_id, branch_id: b.branch_id, booking_id: b.id, booking_item_id: item.id, device_id: item.device_id, customer_id: b.customer_id, status: 'ACTIVE', started_at: now, expected_end_at: expectedEnd, started_by: caller.id },
          });
          await tx.bookings.update({ where: { id: b.id }, data: { status: 'ACTIVE' } });
          await tx.booking_events.create({ data: { id: uuidv7(), booking_id: b.id, type: 'SESSION_STARTED', actor_id: caller.id, data: { session_id: sid, device_id: item.device_id } } });
          await this.audit.log({ actor_id: caller.id, club_id: b.club_id, action: 'session.start', target_type: 'session', target_id: sid }, tx);
          return sid;
        });
        created.push(id);
        await this.notifications.notify([b.customer_id], 'SESSION_STARTED', { device: device.name, until: fmtTime(expectedEnd, ctx.branch.timezone) }, { session_id: id, booking_id: b.id });
      } catch (e) {
        if (UNIQUE_LIVE.test(String((e as Error).message))) throw new AppException('SESSION_ALREADY_ACTIVE', `${device.name} already has an active session`, { device_id: device.id });
        throw e;
      }
    }
    const views = await Promise.all(created.map((id) => this.view(id)));
    views.forEach((v) => this.emitLive(v, 'session.started'));
    return views;
  }

  /** Walk-in (§6.9): bron WALK_IN + darhol check-in + (ixtiyoriy) to'lov + sessiya. */
  async walkIn(dto: WalkInDto, caller: Caller) {
    const ctx = await this.bookings.branchCtx(dto.branch_id, { requireActive: false });
    assertCan(caller.grants, 'bookings.create', { club_id: ctx.club.id, branch_id: ctx.branch.id });
    const start = DateTime.now().startOf('minute').toJSDate();
    const end = new Date(start.getTime() + dto.duration_minutes * 60_000);
    const blockedEnd = new Date(end.getTime() + ctx.settings.buffer_minutes * 60_000);
    const tariffs = await this.pricing.tariffs(ctx.branch.id);
    let customerId: string | null = null;
    if (dto.guest_phone) customerId = (await this.prisma.users.findUnique({ where: { phone: dto.guest_phone } }))?.id ?? null;
    let bookingId: string;
    try {
      bookingId = await this.prisma.$transaction(async (tx) => {
        const devices = await tx.devices.findMany({ where: { id: { in: dto.device_ids }, branch_id: ctx.branch.id, deleted_at: null } });
        if (devices.length !== dto.device_ids.length) throw new AppException('NOT_FOUND', 'Device not found');
        const bad = devices.find((d) => d.operational_status !== 'ACTIVE');
        if (bad) throw new AppException('DEVICE_NOT_AVAILABLE', `${bad.name} is not available`, { device_id: bad.id });
        await this.bookings.expireHolds(tx, { device_ids: dto.device_ids });
        const { reserved, occupied } = await this.bookings.busy(tx, dto.device_ids, start, blockedEnd);
        const busy = devices.find((d) => reserved.has(d.id) || occupied.has(d.id));
        if (busy) throw new AppException('BOOKING_SLOT_TAKEN', `${busy.name} is busy for this period`, { device_id: busy.id });
        const quotes = devices.map((d) => ({ d, q: this.pricing.quoteDevice(tariffs, d, start, end, ctx.branch.timezone) }));
        const total = quotes.reduce((s, x) => s + x.q.amount, 0n);
        const id = uuidv7();
        await tx.bookings.create({
          data: {
            id, code: bookingCode(), customer_id: customerId, guest_name: dto.guest_name, guest_phone: dto.guest_phone, club_id: ctx.club.id, branch_id: ctx.branch.id,
            source: 'WALK_IN', status: 'CHECKED_IN', start_at: start, end_at: end, duration_minutes: dto.duration_minutes, subtotal_amount: total, total_amount: total,
            payment_status: total === 0n ? 'PAID' : 'UNPAID', checked_in_at: start, checked_in_by: caller.id,
          },
        });
        await tx.booking_items.createMany({
          data: quotes.map((x) => ({
            id: uuidv7(), booking_id: id, club_id: ctx.club.id, branch_id: ctx.branch.id, device_id: x.d.id, category_id: x.d.category_id, start_at: start, end_at: end,
            blocked_until: blockedEnd, active: true, price_amount: x.q.amount, tariff_id: x.q.tariff_id, price_breakdown: { segments: x.q.segments } as unknown as Prisma.InputJsonValue,
          })),
        });
        if (dto.payment_method !== 'LATER' && total > 0n) {
          const shift = await this.finance.openShift(tx, caller.id, ctx.branch.id);
          await this.finance.recordOffline(tx, { club_id: ctx.club.id, branch_id: ctx.branch.id, booking_id: id, user_id: customerId, amount: total, method: dto.payment_method, operator_id: caller.id, shift_id: shift.id });
        }
        await tx.booking_events.create({ data: { id: uuidv7(), booking_id: id, type: 'WALK_IN', actor_id: caller.id } });
        await this.audit.log({ actor_id: caller.id, club_id: ctx.club.id, action: 'booking.walk_in', target_type: 'booking', target_id: id, new_value: { devices: devices.map((d) => d.name), total: Number(total) } }, tx);
        return id;
      });
    } catch (e) {
      if (EXCLUSION.test(String((e as Error).message))) throw new AppException('BOOKING_SLOT_TAKEN', 'Device is busy for this period');
      throw e;
    }
    this.realtime.branch(ctx.branch.id, 'booking.created', { booking_id: bookingId, source: 'WALK_IN' });
    if (dto.start_now !== false) await this.startFromBooking(bookingId, caller);
    return this.bookings.detail(bookingId);
  }

  // ---------- Boshqaruv ----------

  async pause(id: string, caller: Caller) {
    const s = await this.load(id, caller, 'sessions.pause');
    if (s.status !== 'ACTIVE') throw new AppException('CONFLICT', `Cannot pause a ${s.status} session`);
    await this.prisma.sessions.update({ where: { id }, data: { status: 'PAUSED', paused_at: new Date() } });
    await this.audit.log({ actor_id: caller.id, club_id: s.club_id, action: 'session.pause', target_type: 'session', target_id: id });
    const v = await this.view(id);
    this.emitLive(v, 'session.updated');
    return v;
  }

  async resume(id: string, caller: Caller) {
    const s = await this.load(id, caller, 'sessions.pause');
    if (s.status !== 'PAUSED' || !s.paused_at) throw new AppException('CONFLICT', `Cannot resume a ${s.status} session`);
    const pausedMs = Date.now() - s.paused_at.getTime();
    const newEnd = new Date((s.expected_end_at ?? new Date()).getTime() + pausedMs);
    let extended = true;
    await this.prisma.$transaction(async (tx) => {
      if (s.booking_item_id) {
        try {
          await tx.$executeRaw`SAVEPOINT resume_ext`;
          await this.setItemEnd(tx, s.booking_item_id, s.branch_id, newEnd);
          await tx.$executeRaw`RELEASE SAVEPOINT resume_ext`;
        } catch {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT resume_ext`;
          extended = false;
        }
      }
      await tx.sessions.update({
        where: { id },
        data: { status: 'ACTIVE', paused_at: null, total_paused_seconds: { increment: Math.round(pausedMs / 1000) }, ...(extended ? { expected_end_at: newEnd } : {}) },
      });
    });
    await this.audit.log({ actor_id: caller.id, club_id: s.club_id, action: 'session.resume', target_type: 'session', target_id: id, new_value: { paused_seconds: Math.round(pausedMs / 1000), extended } });
    const v = await this.view(id);
    this.emitLive(v, 'session.updated');
    return { ...v, warning: extended ? null : 'NEXT_BOOKING_CONFLICT' };
  }

  private async setItemEnd(tx: Tx, itemId: string, branchId: string, end: Date) {
    const branch = await tx.branches.findUniqueOrThrow({ where: { id: branchId } });
    const buffer = ((branch.booking_settings as { buffer_minutes?: number } | null)?.buffer_minutes ?? 0) * 60_000;
    await tx.booking_items.update({ where: { id: itemId }, data: { end_at: end, blocked_until: new Date(end.getTime() + buffer) } });
  }

  private async charge(tx: Tx, s: { id: string; booking_id: string | null }, type: 'EXTENSION' | 'OVERTIME', minutes: number, amount: bigint, actorId: string, description: string) {
    await tx.session_charges.create({ data: { id: uuidv7(), session_id: s.id, type, minutes, amount, description, created_by: actorId } });
    if (s.booking_id && amount > 0n) {
      await tx.bookings.update({ where: { id: s.booking_id }, data: { subtotal_amount: { increment: amount }, total_amount: { increment: amount } } });
      await this.finance.syncBookingPayment(tx, s.booking_id);
    }
  }

  async extend(id: string, dto: ExtendDto, caller: Caller) {
    const s = await this.load(id, caller, 'sessions.extend');
    if (!['ACTIVE', 'PAUSED'].includes(s.status) || !s.expected_end_at) throw new AppException('CONFLICT', `Cannot extend a ${s.status} session`);
    const ctx = await this.bookings.branchCtx(s.branch_id, { requireActive: false });
    const from = s.expected_end_at;
    const to = new Date(from.getTime() + dto.minutes * 60_000);
    const device = await this.prisma.devices.findUniqueOrThrow({ where: { id: s.device_id } });
    const q = this.pricing.quoteDevice(await this.pricing.tariffs(s.branch_id), device, from, to, ctx.branch.timezone);
    try {
      await this.prisma.$transaction(async (tx) => {
        if (s.booking_item_id) await this.setItemEnd(tx, s.booking_item_id, s.branch_id, to);
        await tx.sessions.update({ where: { id }, data: { expected_end_at: to } });
        if (s.booking_id) await tx.bookings.update({ where: { id: s.booking_id }, data: { end_at: to, duration_minutes: { increment: dto.minutes } } });
        await this.charge(tx, s, 'EXTENSION', dto.minutes, q.amount, caller.id, `+${dto.minutes} min`);
        if (dto.payment_method && dto.payment_method !== 'LATER' && q.amount > 0n) {
          const shift = await this.finance.openShift(tx, caller.id, s.branch_id);
          await this.finance.recordOffline(tx, { club_id: s.club_id, branch_id: s.branch_id, booking_id: s.booking_id, session_id: s.id, user_id: s.customer_id, amount: q.amount, method: dto.payment_method, operator_id: caller.id, shift_id: shift.id });
        }
        await this.audit.log({ actor_id: caller.id, club_id: s.club_id, action: 'session.extend', target_type: 'session', target_id: id, new_value: { minutes: dto.minutes, amount: Number(q.amount) } }, tx);
      });
    } catch (e) {
      if (EXCLUSION.test(String((e as Error).message))) throw new AppException('SESSION_EXTEND_CONFLICT', 'The device is booked right after this session', { device_id: s.device_id });
      throw e;
    }
    const v = await this.view(id);
    this.emitLive(v, 'session.updated');
    return { ...v, extension_amount: q.amount };
  }

  async move(id: string, dto: MoveDto, caller: Caller) {
    const s = await this.load(id, caller, 'sessions.move');
    if (!['ACTIVE', 'PAUSED'].includes(s.status)) throw new AppException('CONFLICT', `Cannot move a ${s.status} session`);
    const to = await this.prisma.devices.findFirst({ where: { id: dto.to_device_id, branch_id: s.branch_id, deleted_at: null } });
    if (!to || to.operational_status !== 'ACTIVE') throw new AppException('DEVICE_NOT_AVAILABLE', 'Target device is not available');
    const from = await this.prisma.devices.findUniqueOrThrow({ where: { id: s.device_id } });
    try {
      await this.prisma.$transaction(async (tx) => {
        if (s.booking_item_id) await tx.booking_items.update({ where: { id: s.booking_item_id }, data: { device_id: to.id, start_at: new Date() } });
        await tx.sessions.update({ where: { id }, data: { device_id: to.id } });
        if (s.booking_id) await tx.booking_events.create({ data: { id: uuidv7(), booking_id: s.booking_id, type: 'SESSION_MOVED', actor_id: caller.id, data: { from: from.name, to: to.name } } });
        await this.audit.log({ actor_id: caller.id, club_id: s.club_id, action: 'session.move', target_type: 'session', target_id: id, old_value: { device: from.name }, new_value: { device: to.name } }, tx);
      });
    } catch (e) {
      const m = String((e as Error).message);
      if (EXCLUSION.test(m) || UNIQUE_LIVE.test(m)) throw new AppException('DEVICE_NOT_AVAILABLE', `${to.name} is busy`, { device_id: to.id });
      throw e;
    }
    const v = await this.view(id);
    this.realtime.branch(s.branch_id, 'device.status.changed', { device_id: s.device_id });
    this.emitLive(v, 'session.updated');
    return v;
  }

  async stop(id: string, dto: StopDto, caller: Caller) {
    const s = await this.load(id, caller, 'sessions.stop');
    if (!LIVE.includes(s.status)) throw new AppException('CONFLICT', `Session is already ${s.status}`);
    const now = new Date();
    const ctx = await this.bookings.branchCtx(s.branch_id, { requireActive: false });
    let overtime = 0;
    let overtimeAmount = 0n;
    if (s.expected_end_at && !dto.waive_overtime) {
      const over = Math.floor((now.getTime() - s.expected_end_at.getTime()) / 60_000);
      if (over > OVERTIME_GRACE_MIN) {
        overtime = over;
        const device = await this.prisma.devices.findUniqueOrThrow({ where: { id: s.device_id } });
        const q = this.pricing.tryQuote(await this.pricing.tariffs(s.branch_id), device, s.expected_end_at, new Date(s.expected_end_at.getTime() + over * 60_000), ctx.branch.timezone);
        overtimeAmount = q?.amount ?? 0n;
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.sessions.update({
        where: { id },
        data: { status: 'COMPLETED', ended_at: now, ended_by: caller.id, end_reason: dto.reason ? 'FORCE_STOPPED' : 'COMPLETED', overtime_minutes: overtime || null, paused_at: null },
      });
      if (overtime) await this.charge(tx, s, 'OVERTIME', overtime, overtimeAmount, caller.id, `Overtime ${overtime} min`);
      if (s.booking_item_id) await tx.booking_items.update({ where: { id: s.booking_item_id }, data: { active: false } });
      if (s.booking_id) {
        const live = await tx.sessions.count({ where: { booking_id: s.booking_id, status: { in: LIVE } } });
        const activeItems = await tx.booking_items.count({ where: { booking_id: s.booking_id, active: true } });
        if (!live && !activeItems) await tx.bookings.update({ where: { id: s.booking_id }, data: { status: 'COMPLETED' } });
        await tx.booking_events.create({ data: { id: uuidv7(), booking_id: s.booking_id, type: 'SESSION_ENDED', actor_id: caller.id, data: { session_id: id, overtime, reason: dto.reason ?? null } } });
      }
      await this.audit.log({ actor_id: caller.id, club_id: s.club_id, action: 'session.stop', target_type: 'session', target_id: id, new_value: { reason: dto.reason, overtime } }, tx);
    });
    const device = await this.prisma.devices.findUnique({ where: { id: s.device_id } });
    await this.notifications.notify([s.customer_id], 'SESSION_ENDED', { device: device?.name ?? '' }, { session_id: id, booking_id: s.booking_id });
    const v = await this.view(id);
    this.emitLive(v, 'session.ended');
    return { ...v, overtime_minutes: overtime, overtime_amount: overtimeAmount };
  }

  // ---------- O'qish / live board ----------

  async active(caller: Caller, branchId?: string) {
    let where: Prisma.sessionsWhereInput;
    if (branchId) {
      const b = await this.prisma.branches.findFirst({ where: { id: branchId } });
      if (!b) throw new AppException('NOT_FOUND', 'Branch not found');
      assertCan(caller.grants, 'sessions.view', { club_id: b.club_id, branch_id: b.id });
      where = { branch_id: branchId, status: { in: LIVE } };
    } else {
      where = { customer_id: caller.id, status: { in: LIVE } };
    }
    const rows = await this.prisma.sessions.findMany({ where, orderBy: { started_at: 'asc' } });
    const views = await Promise.all(rows.map((r) => this.view(r.id)));
    const branches = await this.prisma.branches.findMany({ where: { id: { in: rows.map((r) => r.branch_id) } }, select: { id: true, name: true, address: true, club: { select: { name: true } } } });
    const byId = new Map(branches.map((b) => [b.id, b]));
    return views.map((v) => ({ ...v, branch: byId.get(v.branch_id) ?? null }));
  }

  async get(id: string, caller: Caller) {
    await this.load(id, caller, 'sessions.view');
    return this.view(id);
  }

  /** Live board (§6.11, designn/admin-live.html): qurilmalar + occupancy + qolgan vaqt + KPI. */
  async live(branchId: string, caller: Caller) {
    const branch = await this.prisma.branches.findFirst({ where: { id: branchId, deleted_at: null }, include: { club: { select: { id: true, name: true } } } });
    if (!branch) throw new AppException('NOT_FOUND', 'Branch not found');
    assertCan(caller.grants, 'sessions.view', { club_id: branch.club_id, branch_id: branch.id });
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 3600_000);
    const [devices, sessions, upcoming] = await Promise.all([
      this.prisma.devices.findMany({ where: { branch_id: branchId, deleted_at: null }, orderBy: [{ position_order: 'asc' }, { name: 'asc' }], include: { room: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } } }),
      this.prisma.sessions.findMany({ where: { branch_id: branchId, status: { in: LIVE } } }),
      this.prisma.booking_items.findMany({
        where: { branch_id: branchId, active: true, end_at: { gt: now }, start_at: { lt: soon }, booking: { status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN'] } } },
        include: { booking: { select: { id: true, code: true, status: true, customer_id: true, guest_name: true, start_at: true, end_at: true, hold_expires_at: true, total_amount: true, paid_amount: true } } },
        orderBy: { start_at: 'asc' },
      }),
    ]);
    const liveBookingIds = [...new Set(sessions.map((s) => s.booking_id).filter((x): x is string => !!x))];
    const bookings = await this.prisma.bookings.findMany({ where: { id: { in: liveBookingIds } }, select: { id: true, code: true, guest_name: true, customer_id: true, total_amount: true, paid_amount: true } });
    const customerIds = [...new Set([...bookings.map((b) => b.customer_id), ...upcoming.map((u) => u.booking.customer_id)].filter((x): x is string => !!x))];
    const customers = await this.prisma.users.findMany({ where: { id: { in: customerIds } }, select: { id: true, first_name: true, last_name: true } });
    const cName = new Map(customers.map((c) => [c.id, [c.first_name, c.last_name].filter(Boolean).join(' ') || null]));
    const bById = new Map(bookings.map((b) => [b.id, b]));
    const nowMs = now.getTime();
    const board = devices.map((d) => {
      const s = sessions.find((x) => x.device_id === d.id);
      const next = upcoming.find((u) => u.device_id === d.id && (u.booking.status !== 'PENDING_PAYMENT' || (!!u.booking.hold_expires_at && u.booking.hold_expires_at > now)));
      let occupancy: 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'UNAVAILABLE' = 'AVAILABLE';
      if (d.operational_status !== 'ACTIVE') occupancy = 'UNAVAILABLE';
      else if (s) occupancy = 'OCCUPIED';
      else if (next && next.start_at.getTime() - nowMs < 30 * 60_000) occupancy = 'RESERVED';
      const sb = s?.booking_id ? bById.get(s.booking_id) : undefined;
      const pausedExtra = s?.status === 'PAUSED' && s.paused_at ? nowMs - s.paused_at.getTime() : 0;
      return {
        id: d.id, name: d.name, type: d.type, room: d.room, category: d.category, layout: d.layout, operational_status: d.operational_status, occupancy,
        session: s
          ? {
              id: s.id, status: s.status, started_at: s.started_at, expected_end_at: s.expected_end_at, booking_id: s.booking_id, booking_code: sb?.code ?? null,
              customer_name: (sb?.customer_id ? cName.get(sb.customer_id) : null) ?? sb?.guest_name ?? null,
              remaining_seconds: s.expected_end_at ? Math.round((s.expected_end_at.getTime() + pausedExtra - nowMs) / 1000) : null,
              amount_due: sb ? sb.total_amount - sb.paid_amount : 0n,
            }
          : null,
        next_booking: next
          ? { id: next.booking.id, code: next.booking.code, status: next.booking.status, start_at: next.start_at, end_at: next.end_at, customer_name: (next.booking.customer_id ? cName.get(next.booking.customer_id) : null) ?? next.booking.guest_name ?? null }
          : null,
      };
    });
    const tz = branch.timezone;
    const dayStart = DateTime.now().setZone(tz).startOf('day').toJSDate();
    const [paid, refunds] = await Promise.all([
      this.prisma.payments.aggregate({ where: { branch_id: branchId, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, paid_at: { gte: dayStart } }, _sum: { amount: true } }),
      this.prisma.refunds.aggregate({ where: { club_id: branch.club_id, payment_id: { in: (await this.prisma.payments.findMany({ where: { branch_id: branchId }, select: { id: true } })).map((p) => p.id) }, created_at: { gte: dayStart } }, _sum: { amount: true } }),
    ]);
    const shift = await this.prisma.cash_shifts.findFirst({ where: { operator_id: caller.id, branch_id: branchId, status: 'OPEN' } });
    // Zal sxemasi uchun xonalar (grid o'lchami + bezaklar)
    const rooms = await this.prisma.rooms.findMany({
      where: { branch_id: branchId, deleted_at: null },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, type: true, grid_cols: true, grid_rows: true, decor: true },
    });
    return {
      rooms,
      branch: { id: branch.id, name: branch.name, club_id: branch.club_id, club_name: branch.club.name, timezone: tz },
      stats: {
        today_revenue: (paid._sum.amount ?? 0n) - (refunds._sum.amount ?? 0n),
        active_sessions: sessions.filter((s) => s.status !== 'COMPLETED').length,
        free_devices: board.filter((d) => d.occupancy === 'AVAILABLE').length,
        upcoming_bookings: new Set(upcoming.filter((u) => u.start_at.getTime() - nowMs < 2 * 3600_000 && u.start_at > now).map((u) => u.booking_id)).size,
        total_devices: devices.length,
      },
      devices: board,
      upcoming: upcoming.map((u) => ({ booking_id: u.booking.id, code: u.booking.code, status: u.booking.status, device_id: u.device_id, start_at: u.start_at, end_at: u.end_at, customer_name: (u.booking.customer_id ? cName.get(u.booking.customer_id) : null) ?? u.booking.guest_name ?? null })),
      open_shift: shift ? { id: shift.id, opened_at: shift.opened_at } : null,
      server_time: now.toISOString(),
    };
  }
}
