import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { safeEqual } from '../../common/utils/crypto';
import { fmtMoney, fmtWhen } from '../../common/utils/format';
import { uuidv7 } from '../../common/utils/id';
import { RealtimeService } from '../realtime/realtime.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Actor } from '../clubs/clubs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertCan, can, scopeFilter, scopeWhere } from '../rbac/access';
import { Grant } from '../rbac/rbac.service';
import { SettingsService } from '../settings/settings.service';
import { CashPaymentDto, CloseShiftDto, OpenShiftDto, PaymentListQuery, RefundDto, ShiftListQuery } from './dto/payments.dto';
import { FinanceService } from './finance.service';
import { PaymentProviders } from './providers/registry';

export interface NormalizedEvent {
  provider: string;
  event_id: string;
  payment_id: string;
  status: 'PAID' | 'FAILED';
  provider_transaction_id?: string;
  raw: unknown;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
    private readonly providers: PaymentProviders,
  ) {}

  /** DEMO provayder (PaymentProvider interfeysi, docs/01-API.md §6.10) — haqiqiy Payme/Click adapteri shu shaklda. */
  private demoSign(body: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('QR_HMAC_SECRET')).update(`demo:${body}`).digest('hex');
  }

  providersList() {
    return this.providers.enabled();
  }

  async checkout(userId: string, bookingId: string, provider: string, returnUrl?: string) {
    const adapter = await this.providers.require(provider);
    const b = await this.prisma.bookings.findFirst({ where: { id: bookingId, customer_id: userId } });
    if (!b) throw new AppException('NOT_FOUND', 'Booking not found');
    if (!['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE'].includes(b.status)) throw new AppException('CONFLICT', `Cannot pay a ${b.status} booking`);
    if (b.status === 'PENDING_PAYMENT' && b.hold_expires_at && b.hold_expires_at <= new Date()) throw new AppException('BOOKING_HOLD_EXPIRED', 'Hold expired');
    const due = b.total_amount - b.paid_amount;
    if (due <= 0n) throw new AppException('PAYMENT_ALREADY_PAID', 'Booking is already paid');
    // Bir bronda bitta ochiq checkout: mavjud PENDING qayta ishlatiladi
    const existing = await this.prisma.payments.findFirst({ where: { booking_id: bookingId, status: { in: ['PENDING', 'PROCESSING'] }, amount: due, provider } });
    const payment = existing ?? (await this.prisma.payments.create({
      data: { id: uuidv7(), booking_id: bookingId, user_id: userId, club_id: b.club_id, branch_id: b.branch_id, amount: due, method: 'ONLINE_CARD', provider, status: 'PENDING' },
    }));
    // To'lov jarayonida hold bir marta +2 daqiqa uzaytiriladi (§7.3)
    if (b.status === 'PENDING_PAYMENT' && b.hold_expires_at && b.hold_expires_at.getTime() - Date.now() < 2 * 60_000 && !existing) {
      await this.prisma.bookings.update({ where: { id: bookingId }, data: { hold_expires_at: new Date(b.hold_expires_at.getTime() + 2 * 60_000) } });
    }
    return { payment_id: payment.id, amount: payment.amount, provider, checkout_url: adapter.createCheckout(payment, returnUrl).url, hold_expires_at: b.hold_expires_at };
  }

  /** Demo sahifasidan: "to'lash"/"rad etish" — webhook bilan bir xil yo'l orqali qayta ishlanadi. */
  async demoConfirm(userId: string, paymentId: string, success: boolean) {
    const p = await this.prisma.payments.findFirst({ where: { id: paymentId, user_id: userId, provider: 'DEMO' } });
    if (!p) throw new AppException('NOT_FOUND', 'Payment not found');
    return this.handleEvent({ provider: 'DEMO', event_id: `demo-${paymentId}-${success ? 'ok' : 'fail'}-${p.status}`, payment_id: paymentId, status: success ? 'PAID' : 'FAILED', provider_transaction_id: `demo-${uuidv7().slice(-12)}`, raw: { success } });
  }

  /** Imzolangan demo webhook: `X-Signature: hex(hmac(body))`. */
  async demoWebhook(rawBody: string, signature: string | undefined) {
    if (!signature || !safeEqual(signature, this.demoSign(rawBody))) throw new AppException('UNAUTHORIZED', 'Invalid signature');
    const body = JSON.parse(rawBody) as { event_id: string; payment_id: string; status: 'PAID' | 'FAILED'; transaction_id?: string };
    return this.handleEvent({ provider: 'DEMO', event_id: body.event_id, payment_id: body.payment_id, status: body.status, provider_transaction_id: body.transaction_id, raw: body });
  }

  /**
   * Webhook qayta ishlash (§6.10): payment_events unique (provider,event_id) — takror kelsa ta'sirsiz.
   * PAID → booking CONFIRMED; hold tugagan bo'lsa slot qayta band qilinadi yoki avtomatik refund.
   */
  async handleEvent(ev: NormalizedEvent) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      try {
        await tx.payment_events.create({ data: { id: uuidv7(), provider: ev.provider, event_id: ev.event_id, payment_id: ev.payment_id, raw: ev.raw as Prisma.InputJsonValue, processed_at: new Date() } });
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') return { duplicate: true as const };
        throw e;
      }
      const p = await tx.payments.findUnique({ where: { id: ev.payment_id } });
      if (!p) throw new AppException('NOT_FOUND', 'Payment not found');
      if (p.status === 'PAID') return { duplicate: true as const };
      if (ev.status === 'FAILED') {
        await tx.payments.update({ where: { id: p.id }, data: { status: 'FAILED', failed_reason: 'Declined by provider' } });
        return { status: 'FAILED' as const, payment: p };
      }
      await this.finance.markPaid(tx, p.id, ev.provider_transaction_id);
      let autoRefunded = false;
      if (p.booking_id) {
        const b = await tx.bookings.findUniqueOrThrow({ where: { id: p.booking_id } });
        if (b.status === 'PENDING_PAYMENT') {
          await tx.bookings.update({ where: { id: b.id }, data: { status: 'CONFIRMED', hold_expires_at: null } });
          await tx.booking_events.create({ data: { id: uuidv7(), booking_id: b.id, type: 'CONFIRMED', data: { payment_id: p.id } } });
        } else if (b.status === 'EXPIRED') {
          // Payment-after-expiry: slot bo'sh bo'lsa qayta band qilamiz, aks holda refund
          try {
            await tx.$executeRaw`SAVEPOINT reactivate`;
            await tx.booking_items.updateMany({ where: { booking_id: b.id }, data: { active: true } });
            await tx.bookings.update({ where: { id: b.id }, data: { status: 'CONFIRMED', hold_expires_at: null } });
            await tx.$executeRaw`RELEASE SAVEPOINT reactivate`;
            await tx.booking_events.create({ data: { id: uuidv7(), booking_id: b.id, type: 'CONFIRMED_AFTER_EXPIRY' } });
          } catch {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT reactivate`;
            await this.finance.refundBooking(tx, b.id, p.amount, 'Payment after hold expiry — slot taken', null);
            await tx.booking_events.create({ data: { id: uuidv7(), booking_id: b.id, type: 'AUTO_REFUND_AFTER_EXPIRY' } });
            autoRefunded = true;
          }
        }
      }
      return { status: 'PAID' as const, payment: p, autoRefunded };
    });
    if ('duplicate' in outcome) return { processed: false, duplicate: true };
    const p = outcome.payment;
    const b = p.booking_id ? await this.prisma.bookings.findUnique({ where: { id: p.booking_id } }) : null;
    if (outcome.status === 'PAID') {
      await this.notifications.notify([p.user_id], 'PAYMENT_SUCCESS', { amount: fmtMoney(p.amount), code: b?.code ?? '' }, { booking_id: p.booking_id, payment_id: p.id });
      if (b && b.status === 'CONFIRMED') {
        const branch = await this.prisma.branches.findUnique({ where: { id: b.branch_id }, include: { club: true } });
        await this.notifications.notify([b.customer_id], 'BOOKING_CONFIRMED', { code: b.code, club: branch?.club.name ?? '', when: fmtWhen(b.start_at, branch?.timezone) }, { booking_id: b.id });
        await this.notifications.notifyClubStaff(b.club_id, b.branch_id, 'NEW_BOOKING', { code: b.code, when: fmtWhen(b.start_at, branch?.timezone), devices: '' }, { booking_id: b.id });
      }
      if (outcome.autoRefunded) await this.notifications.notify([p.user_id], 'REFUND_COMPLETED', { amount: fmtMoney(p.amount), code: b?.code ?? '' });
    } else {
      await this.notifications.notify([p.user_id], 'PAYMENT_FAILED', { code: b?.code ?? '' }, { booking_id: p.booking_id });
    }
    return { processed: true, status: outcome.status, booking_status: b?.status ?? null };
  }

  // ---------- Operator: naqd/terminal ----------

  async cash(dto: CashPaymentDto, grants: Grant[], actor: Actor) {
    if (!dto.booking_id && !dto.session_id) throw new AppException('VALIDATION_ERROR', 'booking_id or session_id is required', {});
    let bookingId = dto.booking_id ?? null;
    if (!bookingId && dto.session_id) {
      const s = await this.prisma.sessions.findUnique({ where: { id: dto.session_id } });
      bookingId = s?.booking_id ?? null;
    }
    const b = bookingId ? await this.prisma.bookings.findUnique({ where: { id: bookingId } }) : null;
    if (!b) throw new AppException('NOT_FOUND', 'Booking not found');
    assertCan(grants, 'payments.create', { club_id: b.club_id, branch_id: b.branch_id });
    if (['CANCELLED', 'EXPIRED'].includes(b.status)) throw new AppException('CONFLICT', `Cannot take payment for ${b.status} booking`);
    const due = b.total_amount - b.paid_amount;
    const amount = dto.amount ? BigInt(dto.amount) : due;
    if (amount <= 0n) throw new AppException('PAYMENT_ALREADY_PAID', 'Nothing to pay');
    const payment = await this.prisma.$transaction(async (tx) => {
      const shift = await this.finance.openShift(tx, actor.id, b.branch_id);
      const p = await this.finance.recordOffline(tx, { club_id: b.club_id, branch_id: b.branch_id, booking_id: b.id, session_id: dto.session_id, user_id: b.customer_id, amount, method: dto.method, operator_id: actor.id, shift_id: shift.id });
      if (b.status === 'PENDING_PAYMENT') {
        const fresh = await tx.bookings.findUniqueOrThrow({ where: { id: b.id } });
        if (fresh.paid_amount >= fresh.total_amount) await tx.bookings.update({ where: { id: b.id }, data: { status: 'CONFIRMED', hold_expires_at: null } });
      }
      await tx.booking_events.create({ data: { id: uuidv7(), booking_id: b.id, type: 'PAYMENT', actor_id: actor.id, data: { method: dto.method, amount: Number(amount) } } });
      await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'payment.offline', target_type: 'payment', target_id: p.id, new_value: { method: dto.method, amount: Number(amount), booking_id: b.id }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id }, tx);
      return p;
    });
    this.realtime.branch(b.branch_id, 'payment.completed', { booking_id: b.id, payment_id: (payment as { id: string }).id });
    return payment;
  }

  async refund(paymentId: string, dto: RefundDto, grants: Grant[], actor: Actor) {
    const p = await this.prisma.payments.findUnique({ where: { id: paymentId } });
    if (!p) throw new AppException('NOT_FOUND', 'Payment not found');
    assertCan(grants, 'payments.refund', { club_id: p.club_id, branch_id: p.branch_id });
    const amount = dto.amount ? BigInt(dto.amount) : p.amount - p.refunded_amount;
    const refund = await this.prisma.$transaction(async (tx) => {
      const r = await this.finance.refundPayment(tx, p.id, amount, dto.reason, actor.id);
      if (p.booking_id) await this.finance.syncBookingPayment(tx, p.booking_id);
      await this.audit.log({ actor_id: actor.id, club_id: p.club_id, action: 'payment.refund', target_type: 'payment', target_id: p.id, new_value: { amount: Number(amount), reason: dto.reason }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id }, tx);
      return r;
    });
    const b = p.booking_id ? await this.prisma.bookings.findUnique({ where: { id: p.booking_id } }) : null;
    await this.notifications.notify([p.user_id], 'REFUND_COMPLETED', { amount: fmtMoney(amount), code: b?.code ?? '' });
    return refund;
  }

  async get(id: string, userId: string, grants: Grant[]) {
    const p = await this.prisma.payments.findUnique({ where: { id } });
    if (!p) throw new AppException('NOT_FOUND', 'Payment not found');
    if (p.user_id !== userId && !can(grants, 'payments.view', { club_id: p.club_id, branch_id: p.branch_id })) throw new AppException('NOT_FOUND', 'Payment not found');
    const refunds = await this.prisma.refunds.findMany({ where: { payment_id: id } });
    const booking = p.booking_id ? await this.prisma.bookings.findUnique({ where: { id: p.booking_id }, select: { id: true, code: true, status: true, total_amount: true, paid_amount: true, hold_expires_at: true, start_at: true, end_at: true, branch_id: true } }) : null;
    return { ...p, refunds, booking };
  }

  async list(q: PaymentListQuery, grants: Grant[], permission: 'payments.view' | 'platform.payments.view' = 'payments.view') {
    const f = scopeFilter(grants, permission);
    const where: Prisma.paymentsWhereInput = {
      ...(scopeWhere(f) as Prisma.paymentsWhereInput),
      ...(q.club_id ? { club_id: q.club_id } : {}),
      ...(q.branch_id ? { branch_id: q.branch_id } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.from || q.to ? { created_at: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
    };
    const [rows, total, sums] = await Promise.all([
      this.prisma.payments.findMany({ where, orderBy: { created_at: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.payments.count({ where }),
      this.prisma.payments.aggregate({ where: { ...where, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, _sum: { amount: true, refunded_amount: true, commission_amount: true } }),
    ]);
    const bookings = await this.prisma.bookings.findMany({ where: { id: { in: rows.map((r) => r.booking_id).filter((x): x is string => !!x) } }, select: { id: true, code: true } });
    const clubs = await this.prisma.clubs.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.club_id))] } }, select: { id: true, name: true } });
    const code = new Map(bookings.map((b) => [b.id, b.code]));
    const club = new Map(clubs.map((c) => [c.id, c.name]));
    return new Paginated(
      rows.map((r) => ({ ...r, booking_code: r.booking_id ? code.get(r.booking_id) ?? null : null, club_name: club.get(r.club_id) ?? null })),
      {
        page: q.page, limit: q.limit, total,
        summary: { collected: Number(sums._sum.amount ?? 0n), refunded: Number(sums._sum.refunded_amount ?? 0n), commission: Number(sums._sum.commission_amount ?? 0n) },
      },
    );
  }

  // ---------- Kassa smenasi (§6.10) ----------

  async currentShift(userId: string, branchId?: string) {
    const shift = await this.prisma.cash_shifts.findFirst({ where: { operator_id: userId, status: 'OPEN', ...(branchId ? { branch_id: branchId } : {}) } });
    return shift ? this.shiftReport(shift.id) : null;
  }

  async openShift(dto: OpenShiftDto, grants: Grant[], actor: Actor) {
    const b = await this.prisma.branches.findFirst({ where: { id: dto.branch_id, deleted_at: null } });
    if (!b) throw new AppException('NOT_FOUND', 'Branch not found');
    assertCan(grants, 'shifts.open', { club_id: b.club_id, branch_id: b.id });
    const open = await this.prisma.cash_shifts.findFirst({ where: { operator_id: actor.id, status: 'OPEN' } });
    if (open) throw new AppException('CONFLICT', 'You already have an open shift', { shift_id: open.id });
    const s = await this.prisma.cash_shifts.create({ data: { id: uuidv7(), club_id: b.club_id, branch_id: b.id, operator_id: actor.id, opening_cash: BigInt(dto.opening_cash) } });
    await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'shift.open', target_type: 'cash_shift', target_id: s.id, new_value: { opening_cash: dto.opening_cash } });
    return this.shiftReport(s.id);
  }

  async shiftReportFor(id: string, userId: string, grants: Grant[]) {
    const s = await this.prisma.cash_shifts.findUnique({ where: { id } });
    if (!s || (s.operator_id !== userId && !can(grants, 'shifts.view_all', { club_id: s.club_id, branch_id: s.branch_id }))) throw new AppException('NOT_FOUND', 'Shift not found');
    return this.shiftReport(id);
  }

  async shiftReport(id: string) {
    const s = await this.prisma.cash_shifts.findUnique({ where: { id } });
    if (!s) throw new AppException('NOT_FOUND', 'Shift not found');
    const pays = await this.prisma.payments.findMany({ where: { shift_id: id } });
    const cashIn = pays.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.amount, 0n);
    const terminalIn = pays.filter((p) => p.method === 'TERMINAL').reduce((a, p) => a + p.amount, 0n);
    const cashRefunds = pays.filter((p) => p.method === 'CASH').reduce((a, p) => a + p.refunded_amount, 0n);
    const expected = s.opening_cash + cashIn - cashRefunds;
    const branch = await this.prisma.branches.findUnique({ where: { id: s.branch_id }, select: { name: true } });
    const operator = await this.prisma.users.findUnique({ where: { id: s.operator_id }, select: { first_name: true, last_name: true, phone: true } });
    return { ...s, branch_name: branch?.name, operator, totals: { cash_in: cashIn, terminal_in: terminalIn, cash_refunds: cashRefunds, payments_count: pays.length, expected_cash: s.status === 'CLOSED' ? s.expected_cash : expected } };
  }

  async closeShift(id: string, dto: CloseShiftDto, grants: Grant[], actor: Actor) {
    const s = await this.prisma.cash_shifts.findUnique({ where: { id } });
    if (!s) throw new AppException('NOT_FOUND', 'Shift not found');
    const own = s.operator_id === actor.id;
    if (!own && !can(grants, 'shifts.view_all', { club_id: s.club_id, branch_id: s.branch_id })) throw new AppException('NOT_FOUND', 'Shift not found');
    if (s.status !== 'OPEN') throw new AppException('CONFLICT', 'Shift is already closed');
    const report = await this.shiftReport(id);
    const expected = report.totals.expected_cash ?? 0n;
    const counted = BigInt(dto.counted_cash);
    const diff = counted - expected;
    await this.prisma.cash_shifts.update({ where: { id }, data: { status: 'CLOSED', closed_at: new Date(), closing_cash_counted: counted, expected_cash: expected, difference: diff, note: dto.note } });
    await this.audit.log({ actor_id: actor.id, club_id: s.club_id, action: 'shift.close', target_type: 'cash_shift', target_id: id, new_value: { counted: Number(counted), expected: Number(expected), difference: Number(diff) } });
    if (diff !== 0n) {
      const branch = await this.prisma.branches.findUnique({ where: { id: s.branch_id } });
      const owners = await this.prisma.user_roles.findMany({ where: { club_id: s.club_id, role: { code: 'CLUB_OWNER' } }, select: { user_id: true } });
      await this.notifications.notify(owners.map((o) => o.user_id), 'CASH_DIFFERENCE', { branch: branch?.name ?? '', amount: fmtMoney(diff < 0n ? -diff : diff) }, { shift_id: id });
    }
    return this.shiftReport(id);
  }

  async shifts(q: ShiftListQuery, grants: Grant[]) {
    const f = scopeFilter(grants, 'shifts.view_all');
    const where: Prisma.cash_shiftsWhereInput = { ...(scopeWhere(f) as Prisma.cash_shiftsWhereInput), ...(q.branch_id ? { branch_id: q.branch_id } : {}), ...(q.status ? { status: q.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.cash_shifts.findMany({ where, orderBy: { opened_at: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.cash_shifts.count({ where }),
    ]);
    const users = await this.prisma.users.findMany({ where: { id: { in: rows.map((r) => r.operator_id) } }, select: { id: true, first_name: true, last_name: true, phone: true } });
    const branches = await this.prisma.branches.findMany({ where: { id: { in: rows.map((r) => r.branch_id) } }, select: { id: true, name: true } });
    const u = new Map(users.map((x) => [x.id, x]));
    const br = new Map(branches.map((x) => [x.id, x.name]));
    return new Paginated(rows.map((r) => ({ ...r, operator: u.get(r.operator_id) ?? null, branch_name: br.get(r.branch_id) ?? null })), { page: q.page, limit: q.limit, total });
  }

  /** Test/integratsiya uchun: webhook imzosi. */
  signDemo(body: string) {
    return this.demoSign(body);
  }
}
