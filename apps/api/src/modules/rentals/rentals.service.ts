import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { isWithinHours, openState, WorkingHours } from '../../common/domain/working-hours';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { rentalCode } from '../../common/utils/codes';
import { fmtWhen } from '../../common/utils/format';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchesService } from '../clubs/branches.service';
import { Actor } from '../clubs/clubs.service';
import { EntitlementsService } from '../clubs/entitlements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FinanceService } from '../payments/finance.service';
import { RealtimeService } from '../realtime/realtime.service';
import { assertCan, can, scopeFilter, scopeWhere } from '../rbac/access';
import { Grant } from '../rbac/rbac.service';
import {
  CreateRentalDto, HandoverDto, RentalItemDto, RentalItemsQuery, RentalListQuery, RentalQuoteQuery, RentalSlotsQuery, ReturnRentalDto, UpdateRentalItemDto,
} from './dto/rentals.dto';

type Tx = Prisma.TransactionClient;
type Item = Prisma.rental_itemsGetPayload<object>;

/** Konsol band qiladigan holatlar (dona hisobida). */
export const OPEN_RENTAL = ['REQUESTED', 'CONFIRMED', 'ACTIVE'];
const HISTORY_RENTAL = ['RETURNED', 'CANCELLED', 'REJECTED', 'EXPIRED'];
/** Mijozda bir vaqtda ko'pi bilan shuncha ochiq arenda. */
const MAX_OPEN_PER_CUSTOMER = 3;
const MAX_ADVANCE_DAYS = 60;
/** Kechikish shu daqiqadan keyin hisoblanadi. */
const LATE_GRACE_MINUTES = 15;
const FULL_PHONE_ROLES = ['SUPER_ADMIN', 'CLUB_OWNER', 'CLUB_ADMIN', 'BRANCH_ADMIN', 'OPERATOR'];

export interface Caller {
  id: string;
  grants: Grant[];
}

/** Narx snapshot'i: arenda yaratilgan paytdagi narxlar (keyin o'zgarsa ham kechikish haqi shular bo'yicha). */
type ItemSnapshot = { name: string; type: string; image_url: string | null; price_per_hour: number | null; price_per_day: number | null; deposit_amount: number };

const branchSelect = {
  id: true, name: true, slug: true, address: true, latitude: true, longitude: true, phone: true, timezone: true,
  club: { select: { id: true, name: true, slug: true, logo_url: true, phone: true } },
} satisfies Prisma.branchesSelect;

@Injectable()
export class RentalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branches: BranchesService,
    private readonly entitlements: EntitlementsService,
    private readonly notifications: NotificationsService,
    private readonly finance: FinanceService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------- Inventar (klub) ----------

  private async loadItem(id: string, grants: Grant[], permission: 'rentals.view' | 'rentals.manage') {
    const it = await this.prisma.rental_items.findFirst({ where: { id, deleted_at: null } });
    if (!it) throw new AppException('NOT_FOUND', 'Rental item not found');
    assertCan(grants, permission, { club_id: it.club_id, branch_id: it.branch_id });
    return it;
  }

  private assertPricing(v: { price_per_hour?: number | bigint | null; price_per_day?: number | bigint | null }) {
    if (v.price_per_hour == null && v.price_per_day == null) {
      throw new AppException('VALIDATION_ERROR', 'Set an hourly or a daily price', { field: 'price_per_hour' });
    }
  }

  private itemData(dto: Partial<RentalItemDto>) {
    const big = (n: number | null | undefined) => (n === undefined ? undefined : n === null ? null : BigInt(n));
    return {
      ...dto,
      price_per_hour: big(dto.price_per_hour),
      price_per_day: big(dto.price_per_day),
      deposit_amount: dto.deposit_amount === undefined ? undefined : BigInt(dto.deposit_amount),
      delivery_fee: dto.delivery_fee === undefined ? undefined : BigInt(dto.delivery_fee),
    };
  }

  async manageList(branchId: string, grants: Grant[]) {
    await this.branches.load(branchId, grants, 'rentals.view');
    const items = await this.prisma.rental_items.findMany({ where: { branch_id: branchId, deleted_at: null }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] });
    const now = new Date();
    const usage = await this.usageNow(items.map((i) => i.id), now);
    const open = await this.prisma.rentals.groupBy({ by: ['item_id', 'status'], where: { item_id: { in: items.map((i) => i.id) }, status: { in: OPEN_RENTAL } }, _count: { _all: true } });
    return items.map((it) => ({
      ...it,
      out_now: usage.get(it.id) ?? 0,
      available_now: Math.max(0, it.quantity - (usage.get(it.id) ?? 0)),
      requested_count: open.filter((o) => o.item_id === it.id && o.status === 'REQUESTED').reduce((s, o) => s + o._count._all, 0),
      open_count: open.filter((o) => o.item_id === it.id).reduce((s, o) => s + o._count._all, 0),
    }));
  }

  async createItem(branchId: string, dto: RentalItemDto, grants: Grant[], actor: Actor) {
    const b = await this.branches.load(branchId, grants, 'rentals.manage');
    this.assertPricing(dto);
    const it = await this.prisma.rental_items.create({ data: { id: uuidv7(), club_id: b.club_id, branch_id: b.id, ...this.itemData(dto), name: dto.name, type: dto.type } });
    await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'rental_item.create', target_type: 'rental_item', target_id: it.id, new_value: dto, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return it;
  }

  async updateItem(id: string, dto: UpdateRentalItemDto, grants: Grant[], actor: Actor) {
    const it = await this.loadItem(id, grants, 'rentals.manage');
    this.assertPricing({
      price_per_hour: dto.price_per_hour === undefined ? it.price_per_hour : dto.price_per_hour,
      price_per_day: dto.price_per_day === undefined ? it.price_per_day : dto.price_per_day,
    });
    const u = await this.prisma.rental_items.update({ where: { id }, data: this.itemData(dto) });
    await this.audit.log({
      actor_id: actor.id, club_id: it.club_id, action: 'rental_item.update', target_type: 'rental_item', target_id: id,
      old_value: { price_per_hour: it.price_per_hour?.toString() ?? null, price_per_day: it.price_per_day?.toString() ?? null, status: it.status, quantity: it.quantity },
      new_value: dto, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id,
    });
    return u;
  }

  async removeItem(id: string, grants: Grant[], actor: Actor) {
    const it = await this.loadItem(id, grants, 'rentals.manage');
    const open = await this.prisma.rentals.count({ where: { item_id: id, status: { in: OPEN_RENTAL } } });
    if (open) throw new AppException('CONFLICT', 'Item has open rentals', { reason: 'OPEN_RENTALS', count: open });
    await this.prisma.rental_items.update({ where: { id }, data: { deleted_at: new Date(), status: 'INACTIVE' } });
    await this.audit.log({ actor_id: actor.id, club_id: it.club_id, action: 'rental_item.delete', target_type: 'rental_item', target_id: id, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return { deleted: true };
  }

  // ---------- Band donalar ----------

  /** Oraliqda band donalar soni (ochiq arendalar). ACTIVE va qaytarilmagan — muddati o'tsa ham band. */
  private async inUse(tx: Tx, itemId: string, start: Date, end: Date, excludeId?: string) {
    const rows = await tx.rentals.findMany({
      where: { item_id: itemId, status: { in: OPEN_RENTAL }, start_at: { lt: end }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { quantity: true, end_at: true, status: true },
    });
    return rows.filter((r) => r.end_at > start || r.status === 'ACTIVE').reduce((s, r) => s + r.quantity, 0);
  }

  /** Hozir (keyingi 1 soat ichida) band donalar — katalogdagi "hozir bo'sh" uchun. */
  private async usageNow(itemIds: string[], now: Date) {
    if (!itemIds.length) return new Map<string, number>();
    const soon = new Date(now.getTime() + 3600_000);
    const rows = await this.prisma.rentals.findMany({
      where: { item_id: { in: itemIds }, status: { in: OPEN_RENTAL }, start_at: { lt: soon } },
      select: { item_id: true, quantity: true, end_at: true, status: true },
    });
    const m = new Map<string, number>();
    for (const r of rows) if (r.end_at > now || r.status === 'ACTIVE') m.set(r.item_id, (m.get(r.item_id) ?? 0) + r.quantity);
    return m;
  }

  // ---------- Ommaviy katalog ----------

  private publicWhere(): Prisma.rental_itemsWhereInput {
    return { deleted_at: null, status: 'ACTIVE', branch: { status: 'ACTIVE', deleted_at: null, club: { status: 'ACTIVE', deleted_at: null } } };
  }

  async catalog(q: RentalItemsQuery) {
    const where: Prisma.rental_itemsWhereInput = {
      ...this.publicWhere(),
      ...(q.branch_id ? { branch_id: q.branch_id } : {}),
      ...(q.club_id ? { club_id: q.club_id } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.rate_unit === 'HOUR' ? { price_per_hour: { not: null } } : q.rate_unit === 'DAY' ? { price_per_day: { not: null } } : {}),
      ...(q.delivery === 'true' ? { delivery_available: true } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { games: { has: q.q } }, { branch: { club: { name: { contains: q.q, mode: 'insensitive' } } } }] } : {}),
    };
    const items = await this.prisma.rental_items.findMany({ where, orderBy: [{ position: 'asc' }, { created_at: 'desc' }], take: 200, include: { branch: { select: branchSelect } } });
    const usage = await this.usageNow(items.map((i) => i.id), new Date());
    return items.map((it) => this.publicItem(it, usage.get(it.id) ?? 0));
  }

  private publicItem(it: Item & { branch?: unknown }, used: number) {
    return {
      id: it.id, club_id: it.club_id, branch_id: it.branch_id, name: it.name, type: it.type, description: it.description, image_url: it.image_url,
      includes: it.includes, games: it.games, quantity: it.quantity, price_per_hour: it.price_per_hour, price_per_day: it.price_per_day,
      min_hours: it.min_hours, max_days: it.max_days, deposit_amount: it.deposit_amount, delivery_available: it.delivery_available,
      delivery_fee: it.delivery_fee, requirements: it.requirements, available_now: Math.max(0, it.quantity - used), branch: it.branch,
    };
  }

  async item(id: string) {
    const it = await this.prisma.rental_items.findFirst({ where: { id, ...this.publicWhere() }, include: { branch: { select: { ...branchSelect, working_hours: true } } } });
    if (!it) throw new AppException('NOT_FOUND', 'Rental item not found');
    const usage = await this.usageNow([id], new Date());
    const exceptions = await this.prisma.branch_hours_exceptions.findMany({ where: { branch_id: it.branch_id, date: { gte: new Date(Date.now() - 2 * 86400_000) } } });
    const open = openState(it.branch.working_hours as WorkingHours, exceptions, it.branch.timezone);
    return { ...this.publicItem(it, usage.get(id) ?? 0), branch: { ...it.branch, ...open } };
  }

  // ---------- Narx va tekshiruv ----------

  private async branchCtx(branchId: string) {
    const branch = await this.prisma.branches.findFirst({ where: { id: branchId, deleted_at: null }, include: { club: true } });
    if (!branch) throw new AppException('NOT_FOUND', 'Branch not found');
    const exceptions = await this.prisma.branch_hours_exceptions.findMany({ where: { branch_id: branchId, date: { gte: new Date(Date.now() - 2 * 86400_000) } } });
    return { branch, club: branch.club, exceptions };
  }

  /** Narx: dona narxi × birlik × soni + yetkazish. Garov alohida (to'lov summasiga kirmaydi). */
  private price(it: Item, rateUnit: string, units: number, quantity: number, fulfillment: string) {
    const unit = rateUnit === 'HOUR' ? it.price_per_hour : it.price_per_day;
    if (unit == null) throw new AppException('VALIDATION_ERROR', rateUnit === 'HOUR' ? 'Hourly rental is not available' : 'Daily rental is not available', { field: 'rate_unit', reason: 'UNIT_NOT_OFFERED' });
    if (fulfillment === 'DELIVERY' && !it.delivery_available) throw new AppException('VALIDATION_ERROR', 'Delivery is not available for this item', { field: 'fulfillment', reason: 'NO_DELIVERY' });
    const subtotal = unit * BigInt(units) * BigInt(quantity);
    const delivery = fulfillment === 'DELIVERY' ? it.delivery_fee : 0n;
    return { unit_price: unit, subtotal, delivery_fee: delivery, total: subtotal + delivery, deposit: it.deposit_amount * BigInt(quantity) };
  }

  /** Muddat chegaralari va ish vaqti: olib ketish va qaytarish paytida filial ochiq bo'lishi kerak. */
  private validate(it: Item, ctx: Awaited<ReturnType<RentalsService['branchCtx']>>, rateUnit: string, units: number, start: Date, staff = false) {
    if (rateUnit === 'HOUR' && units < it.min_hours) throw new AppException('VALIDATION_ERROR', `Minimum ${it.min_hours} hours`, { field: 'units', reason: 'MIN_HOURS', min_hours: it.min_hours });
    const hours = rateUnit === 'HOUR' ? units : units * 24;
    if (hours > it.max_days * 24) throw new AppException('VALIDATION_ERROR', `Maximum ${it.max_days} days`, { field: 'units', reason: 'MAX_DAYS', max_days: it.max_days });
    const now = Date.now();
    if (start.getTime() < now - (staff ? 30 : 5) * 60_000) throw new AppException('BOOKING_TOO_EARLY', 'Start time is in the past');
    if (start.getTime() > now + MAX_ADVANCE_DAYS * 86400_000) throw new AppException('BOOKING_TOO_LATE', 'Start time is too far ahead', { max_advance_days: MAX_ADVANCE_DAYS });
    const end = new Date(start.getTime() + hours * 3600_000);
    const wh = ctx.branch.working_hours as WorkingHours;
    const tz = ctx.branch.timezone;
    if (!isWithinHours(wh, ctx.exceptions, tz, start, new Date(start.getTime() + 60_000))) {
      throw new AppException('BOOKING_OUTSIDE_WORKING_HOURS', 'Branch is closed at pickup time', { field: 'start_at', reason: 'PICKUP_CLOSED' });
    }
    if (!isWithinHours(wh, ctx.exceptions, tz, new Date(end.getTime() - 60_000), end)) {
      throw new AppException('BOOKING_OUTSIDE_WORKING_HOURS', 'Branch is closed at return time', { field: 'units', reason: 'RETURN_CLOSED', end_at: end.toISOString() });
    }
    return end;
  }

  async quote(itemId: string, q: RentalQuoteQuery) {
    const it = await this.prisma.rental_items.findFirst({ where: { id: itemId, ...this.publicWhere() } });
    if (!it) throw new AppException('NOT_FOUND', 'Rental item not found');
    const ctx = await this.branchCtx(it.branch_id);
    const quantity = q.quantity ?? 1;
    const fulfillment = q.fulfillment ?? 'PICKUP';
    const p = this.price(it, q.rate_unit, q.units, quantity, fulfillment);
    const start = new Date(q.start_at);
    const end = this.validate(it, ctx, q.rate_unit, q.units, start);
    const used = await this.inUse(this.prisma, it.id, start, end);
    const available = Math.max(0, it.quantity - used);
    return {
      item_id: it.id, rate_unit: q.rate_unit, units: q.units, quantity, fulfillment, start_at: start.toISOString(), end_at: end.toISOString(),
      unit_price: p.unit_price, subtotal: p.subtotal, delivery_fee: p.delivery_fee, total: p.total, deposit: p.deposit,
      available_units: available, is_available: available >= quantity,
    };
  }

  /**
   * Kun bo'yicha olib ketish vaqtlari (30 daq qadam): filial ochiq (olish va qaytarish paytida) va yetarli bo'sh dona bor.
   * Mijoz faqat haqiqatan mumkin bo'lgan vaqtni tanlaydi — server `create` da baribir qayta tekshiradi.
   */
  async slots(itemId: string, q: RentalSlotsQuery) {
    const it = await this.prisma.rental_items.findFirst({ where: { id: itemId, ...this.publicWhere() } });
    if (!it) throw new AppException('NOT_FOUND', 'Rental item not found');
    const ctx = await this.branchCtx(it.branch_id);
    const quantity = q.quantity ?? 1;
    this.price(it, q.rate_unit, q.units, quantity, 'PICKUP');
    const hours = q.rate_unit === 'HOUR' ? q.units : q.units * 24;
    if (q.rate_unit === 'HOUR' && q.units < it.min_hours) throw new AppException('VALIDATION_ERROR', `Minimum ${it.min_hours} hours`, { field: 'units', reason: 'MIN_HOURS', min_hours: it.min_hours });
    if (hours > it.max_days * 24) throw new AppException('VALIDATION_ERROR', `Maximum ${it.max_days} days`, { field: 'units', reason: 'MAX_DAYS', max_days: it.max_days });
    const tz = ctx.branch.timezone;
    const dayStart = DateTime.fromISO(q.date, { zone: tz }).startOf('day');
    const dayEnd = dayStart.plus({ days: 1 });
    const span = hours * 3600_000;
    const rows = await this.prisma.rentals.findMany({
      where: { item_id: it.id, status: { in: OPEN_RENTAL }, start_at: { lt: new Date(dayEnd.toMillis() + span) } },
      select: { quantity: true, start_at: true, end_at: true, status: true },
    });
    const wh = ctx.branch.working_hours as WorkingHours;
    const earliest = Date.now() + 15 * 60_000;
    const out: { start_at: string; end_at: string; available_units: number }[] = [];
    for (let t = dayStart; t < dayEnd; t = t.plus({ minutes: 30 })) {
      const s = t.toMillis();
      const e = s + span;
      if (s < earliest || s > Date.now() + MAX_ADVANCE_DAYS * 86400_000) continue;
      if (!isWithinHours(wh, ctx.exceptions, tz, new Date(s), new Date(s + 60_000))) continue;
      if (!isWithinHours(wh, ctx.exceptions, tz, new Date(e - 60_000), new Date(e))) continue;
      const used = rows.filter((r) => r.start_at.getTime() < e && (r.end_at.getTime() > s || r.status === 'ACTIVE')).reduce((n, r) => n + r.quantity, 0);
      const free = Math.max(0, it.quantity - used);
      if (free >= quantity) out.push({ start_at: new Date(s).toISOString(), end_at: new Date(e).toISOString(), available_units: free });
    }
    return { date: q.date, timezone: tz, slots: out };
  }

  // ---------- Buyurtma ----------

  async create(dto: CreateRentalDto, caller: Caller, idempotencyKey?: string) {
    const it = await this.prisma.rental_items.findFirst({ where: { id: dto.item_id, ...this.publicWhere() } });
    if (!it) throw new AppException('NOT_FOUND', 'Rental item not found');
    const ctx = await this.branchCtx(it.branch_id);
    if (!(await this.entitlements.canAcceptBookings(ctx.club.id))) throw new AppException('CLUB_NOT_ACTIVE', 'Club subscription is not active');
    const quantity = dto.quantity ?? 1;
    const fulfillment = dto.fulfillment ?? 'PICKUP';
    if (fulfillment === 'DELIVERY' && !dto.delivery_address?.trim()) throw new AppException('VALIDATION_ERROR', 'Delivery address is required', { field: 'delivery_address', reason: 'ADDRESS_REQUIRED' });
    const p = this.price(it, dto.rate_unit, dto.units, quantity, fulfillment);
    const start = new Date(dto.start_at);
    const end = this.validate(it, ctx, dto.rate_unit, dto.units, start);

    const user = await this.prisma.users.findUniqueOrThrow({ where: { id: caller.id } });
    if (user.booking_blocked_until && user.booking_blocked_until > new Date()) {
      throw new AppException('CUSTOMER_BOOKING_BLOCKED', 'Booking is temporarily restricted', { until: user.booking_blocked_until.toISOString() });
    }
    const contactPhone = dto.contact_phone ?? user.phone;
    if (!contactPhone) throw new AppException('VALIDATION_ERROR', 'Contact phone is required', { field: 'contact_phone' });
    if (idempotencyKey) {
      const existing = await this.prisma.rentals.findFirst({ where: { customer_id: caller.id, idempotency_key: idempotencyKey } });
      if (existing) return this.detail(existing.id);
    }
    const open = await this.prisma.rentals.count({ where: { customer_id: caller.id, status: { in: OPEN_RENTAL } } });
    if (open >= MAX_OPEN_PER_CUSTOMER) throw new AppException('CONFLICT', 'Too many open rentals', { reason: 'MAX_OPEN_RENTALS', limit: MAX_OPEN_PER_CUSTOMER });

    const snapshot: ItemSnapshot = {
      name: it.name, type: it.type, image_url: it.image_url, price_per_hour: it.price_per_hour == null ? null : Number(it.price_per_hour),
      price_per_day: it.price_per_day == null ? null : Number(it.price_per_day), deposit_amount: Number(it.deposit_amount),
    };
    let rental;
    try {
      rental = await this.prisma.$transaction(async (tx) => {
        // Bir xil konsolga parallel so'rovlar navbat bilan — dona sonidan oshib ketmasin
        await tx.$queryRaw`SELECT id FROM rental_items WHERE id = ${it.id}::uuid FOR UPDATE`;
        const used = await this.inUse(tx, it.id, start, end);
        if (used + quantity > it.quantity) throw new AppException('DEVICE_NOT_AVAILABLE', 'Not enough consoles for this time', { reason: 'NO_UNITS', available: Math.max(0, it.quantity - used) });
        const id = uuidv7();
        return tx.rentals.create({
          data: {
            id, code: rentalCode(), item_id: it.id, club_id: it.club_id, branch_id: it.branch_id, customer_id: caller.id, contact_phone: contactPhone,
            quantity, rate_unit: dto.rate_unit, units: dto.units, start_at: start, end_at: end, unit_price: p.unit_price, subtotal_amount: p.subtotal,
            delivery_fee_amount: p.delivery_fee, total_amount: p.total, deposit_amount: p.deposit, status: 'REQUESTED', fulfillment,
            delivery_address: fulfillment === 'DELIVERY' ? dto.delivery_address!.trim() : null, notes: dto.notes, item_snapshot: snapshot, idempotency_key: idempotencyKey ?? null,
          },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002' && idempotencyKey) {
        const existing = await this.prisma.rentals.findFirst({ where: { customer_id: caller.id, idempotency_key: idempotencyKey } });
        if (existing) return this.detail(existing.id);
      }
      throw e;
    }
    const when = fmtWhen(start, ctx.branch.timezone);
    await this.notifications.notify([caller.id], 'RENTAL_REQUESTED', { code: rental.code, item: it.name, when }, { rental_id: rental.id });
    await this.notifications.notifyClubStaff(ctx.club.id, ctx.branch.id, 'NEW_RENTAL', { code: rental.code, item: it.name, qty: quantity, when, fulfillment: fulfillment === 'DELIVERY' ? '🚚' : '🏪' }, { rental_id: rental.id });
    this.realtime.branch(ctx.branch.id, 'rental.created', { rental_id: rental.id, status: rental.status });
    return this.detail(rental.id);
  }

  /** Kechikish: imtiyozli 15 daqiqadan keyin; tavsiya etilgan haq soatlik (bo'lmasa kunlik) narx bo'yicha. */
  private overdue(r: { status: string; end_at: Date; quantity: number; item_snapshot: Prisma.JsonValue }, now = new Date()) {
    if (r.status !== 'ACTIVE') return { is_overdue: false, overdue_minutes: 0, suggested_late_fee: 0n };
    const minutes = Math.floor((now.getTime() - r.end_at.getTime()) / 60_000);
    if (minutes <= LATE_GRACE_MINUTES) return { is_overdue: false, overdue_minutes: Math.max(0, minutes), suggested_late_fee: 0n };
    const s = r.item_snapshot as ItemSnapshot;
    const fee = s.price_per_hour != null
      ? BigInt(s.price_per_hour) * BigInt(Math.ceil(minutes / 60))
      : BigInt(s.price_per_day ?? 0) * BigInt(Math.ceil(minutes / 1440));
    return { is_overdue: true, overdue_minutes: minutes, suggested_late_fee: fee * BigInt(r.quantity) };
  }

  async detail(id: string, staffView = false, fullPhone = false) {
    const r = await this.prisma.rentals.findUnique({ where: { id }, include: { item: true } });
    if (!r) throw new AppException('NOT_FOUND', 'Rental not found');
    const [branch, payments, customer] = await Promise.all([
      this.prisma.branches.findUnique({ where: { id: r.branch_id }, select: branchSelect }),
      this.prisma.payments.findMany({ where: { rental_id: id }, orderBy: { created_at: 'asc' }, select: { id: true, amount: true, method: true, status: true, paid_at: true, refunded_amount: true, created_at: true } }),
      staffView ? this.prisma.users.findUnique({ where: { id: r.customer_id }, select: { id: true, phone: true, first_name: true, last_name: true } }) : Promise.resolve(null),
    ]);
    const { item, idempotency_key: _k, ...rest } = r;
    void _k;
    const closed = HISTORY_RENTAL.includes(r.status);
    return {
      ...rest,
      item: { id: item.id, name: item.name, type: item.type, image_url: item.image_url, includes: item.includes, games: item.games, requirements: item.requirements, deleted: !!item.deleted_at },
      branch,
      club: branch?.club ?? null,
      amount_due: closed ? 0n : r.total_amount - r.paid_amount > 0n ? r.total_amount - r.paid_amount : 0n,
      ...this.overdue(r),
      payments,
      ...(staffView ? { customer: customer ? { ...customer, phone: fullPhone ? customer.phone : null } : null } : {}),
      can_cancel: ['REQUESTED', 'CONFIRMED'].includes(r.status),
      server_time: new Date().toISOString(),
    };
  }

  private async loadFor(id: string, caller: Caller, permission: 'rentals.view' | 'rentals.process') {
    const r = await this.prisma.rentals.findUnique({ where: { id } });
    if (!r) throw new AppException('NOT_FOUND', 'Rental not found');
    const staff = can(caller.grants, permission, { club_id: r.club_id, branch_id: r.branch_id });
    if (!staff && r.customer_id !== caller.id) throw new AppException('NOT_FOUND', 'Rental not found');
    return { rental: r, staff };
  }

  private fullPhone(caller: Caller) {
    return caller.grants.some((g) => FULL_PHONE_ROLES.includes(g.role));
  }

  async get(id: string, caller: Caller) {
    const { staff } = await this.loadFor(id, caller, 'rentals.view');
    return this.detail(id, staff, this.fullPhone(caller));
  }

  async list(q: RentalListQuery, caller: Caller) {
    const staffMode = q.staff === 'true';
    const now = new Date();
    let where: Prisma.rentalsWhereInput;
    if (staffMode) {
      const f = scopeFilter(caller.grants, 'rentals.view');
      if (!f.platform && !f.clubIds.length && !f.branchIds.length) throw new AppException('FORBIDDEN', 'Permission denied');
      where = { ...scopeWhere(f), ...(q.club_id ? { club_id: q.club_id } : {}), ...(q.branch_id ? { branch_id: q.branch_id } : {}) } as Prisma.rentalsWhereInput;
      if (q.q) where = { ...where, AND: [{ OR: [{ code: { contains: q.q.toUpperCase() } }, { contact_phone: { contains: q.q } }] }] };
    } else {
      where = { customer_id: caller.id };
    }
    if (q.status === 'OPEN') where = { ...where, status: { in: OPEN_RENTAL } };
    else if (q.status === 'HISTORY') where = { ...where, status: { in: HISTORY_RENTAL } };
    else if (q.status === 'OVERDUE') where = { ...where, status: 'ACTIVE', end_at: { lt: new Date(now.getTime() - LATE_GRACE_MINUTES * 60_000) } };
    else if (q.status) where = { ...where, status: q.status };
    const openFirst = q.status === 'OPEN' || q.status === 'OVERDUE';
    const [rows, total] = await Promise.all([
      this.prisma.rentals.findMany({ where, orderBy: openFirst ? { start_at: 'asc' } : { created_at: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.rentals.count({ where }),
    ]);
    const branchIds = [...new Set(rows.map((r) => r.branch_id))];
    const customerIds = [...new Set(rows.map((r) => r.customer_id))];
    const [branches, customers] = await Promise.all([
      this.prisma.branches.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true, address: true, timezone: true, club: { select: { id: true, name: true, logo_url: true } } } }),
      staffMode ? this.prisma.users.findMany({ where: { id: { in: customerIds } }, select: { id: true, phone: true, first_name: true, last_name: true } }) : Promise.resolve([]),
    ]);
    const bById = new Map(branches.map((b) => [b.id, b]));
    const cById = new Map(customers.map((c) => [c.id, c]));
    const fullPhone = this.fullPhone(caller);
    return new Paginated(
      rows.map(({ idempotency_key: _k, ...r }) => {
        void _k;
        const c = cById.get(r.customer_id);
        return {
          ...r,
          ...this.overdue(r, now),
          branch: bById.get(r.branch_id) ?? null,
          ...(staffMode ? { customer: c ? { ...c, phone: fullPhone ? c.phone : null } : null } : {}),
        };
      }),
      { page: q.page, limit: q.limit, total },
    );
  }

  // ---------- Holat o'tishlari ----------

  /** Holatni tranzaksiyada qayta tekshirib o'zgartirish (ikki operator bir vaqtda bossa — biri CONFLICT oladi). */
  private async transition(tx: Tx, id: string, from: string[], data: Prisma.rentalsUpdateInput) {
    const res = await tx.rentals.updateMany({ where: { id, status: { in: from } }, data: data as Prisma.rentalsUpdateManyMutationInput });
    if (!res.count) throw new AppException('CONFLICT', 'Rental status has changed', { reason: 'STATUS_CHANGED' });
  }

  private async after(r: { id: string; branch_id: string; customer_id: string; code: string; item_snapshot: Prisma.JsonValue }, type: string | null, vars: Record<string, string | number> = {}) {
    if (type) await this.notifications.notify([r.customer_id], type, { code: r.code, item: (r.item_snapshot as ItemSnapshot).name, ...vars }, { rental_id: r.id });
    this.realtime.branch(r.branch_id, 'rental.updated', { rental_id: r.id });
    this.realtime.user(r.customer_id, 'rental.updated', { rental_id: r.id });
  }

  async cancel(id: string, caller: Caller, reason?: string) {
    const { rental: r, staff } = await this.loadFor(id, caller, 'rentals.process');
    if (!['REQUESTED', 'CONFIRMED'].includes(r.status)) throw new AppException('BOOKING_NOT_CANCELLABLE', `Cannot cancel a ${r.status} rental`);
    const byCustomer = r.customer_id === caller.id;
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, ['REQUESTED', 'CONFIRMED'], { status: 'CANCELLED', cancelled_at: new Date(), cancelled_by: caller.id, cancel_reason: reason ?? null });
      if (staff && !byCustomer) await this.audit.log({ actor_id: caller.id, club_id: r.club_id, action: 'rental.cancel', target_type: 'rental', target_id: id, new_value: { reason } }, tx);
    });
    await this.after(r, 'RENTAL_CANCELLED');
    if (byCustomer && r.status === 'CONFIRMED') {
      await this.notifications.notifyClubStaff(r.club_id, r.branch_id, 'RENTAL_CANCELLED', { code: r.code, item: (r.item_snapshot as ItemSnapshot).name }, { rental_id: id });
    }
    return this.detail(id, staff && !byCustomer, this.fullPhone(caller));
  }

  private async staffLoad(id: string, caller: Caller) {
    const { rental, staff } = await this.loadFor(id, caller, 'rentals.process');
    if (!staff) throw new AppException('NOT_FOUND', 'Rental not found');
    return rental;
  }

  async confirm(id: string, caller: Caller) {
    const r = await this.staffLoad(id, caller);
    if (r.status !== 'REQUESTED') throw new AppException('CONFLICT', `Cannot confirm a ${r.status} rental`);
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, ['REQUESTED'], { status: 'CONFIRMED', confirmed_at: new Date(), confirmed_by: caller.id });
      await this.audit.log({ actor_id: caller.id, club_id: r.club_id, action: 'rental.confirm', target_type: 'rental', target_id: id }, tx);
    });
    const branch = await this.prisma.branches.findUnique({ where: { id: r.branch_id }, select: { timezone: true, club: { select: { name: true } } } });
    await this.after(r, 'RENTAL_CONFIRMED', { when: fmtWhen(r.start_at, branch?.timezone), club: branch?.club.name ?? '' });
    return this.detail(id, true, this.fullPhone(caller));
  }

  async reject(id: string, caller: Caller, reason: string) {
    const r = await this.staffLoad(id, caller);
    if (!['REQUESTED', 'CONFIRMED'].includes(r.status)) throw new AppException('CONFLICT', `Cannot reject a ${r.status} rental`);
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, ['REQUESTED', 'CONFIRMED'], { status: 'REJECTED', cancelled_at: new Date(), cancelled_by: caller.id, cancel_reason: reason });
      await this.audit.log({ actor_id: caller.id, club_id: r.club_id, action: 'rental.reject', target_type: 'rental', target_id: id, new_value: { reason } }, tx);
    });
    await this.after(r, 'RENTAL_REJECTED', { reason });
    return this.detail(id, true, this.fullPhone(caller));
  }

  /** Klub to'lovni qabul qildi: naqd/terminal — ochiq smena orqali; kartaga o'tkazma — operator tasdiqlaydi. */
  private async collect(tx: Tx, r: { id: string; club_id: string; branch_id: string; customer_id: string }, amount: bigint, method: string, operatorId: string) {
    if (amount <= 0n || method === 'LATER') return;
    if (method === 'CASH' || method === 'TERMINAL') {
      const shift = await this.finance.openShift(tx, operatorId, r.branch_id);
      await this.finance.recordOffline(tx, { club_id: r.club_id, branch_id: r.branch_id, rental_id: r.id, user_id: r.customer_id, amount, method, operator_id: operatorId, shift_id: shift.id });
      return;
    }
    const p = await tx.payments.create({
      data: { id: uuidv7(), club_id: r.club_id, branch_id: r.branch_id, rental_id: r.id, user_id: r.customer_id, amount, method: 'CARD_TRANSFER', provider: 'MANUAL', status: 'PENDING', received_by: operatorId },
    });
    await this.finance.markPaid(tx, p.id);
  }

  async handover(id: string, dto: HandoverDto, caller: Caller) {
    const r = await this.staffLoad(id, caller);
    if (!['REQUESTED', 'CONFIRMED'].includes(r.status)) throw new AppException('CONFLICT', `Cannot hand over a ${r.status} rental`);
    const now = new Date();
    const depositHeld = r.deposit_amount > 0n && dto.deposit_collected !== false;
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, ['REQUESTED', 'CONFIRMED'], {
        status: 'ACTIVE', handed_over_at: now, handed_over_by: caller.id, deposit_status: depositHeld ? 'HELD' : 'NONE',
        ...(r.confirmed_at ? {} : { confirmed_at: now, confirmed_by: caller.id }),
      });
      await this.collect(tx, r, r.total_amount - r.paid_amount, dto.payment_method, caller.id);
      await this.audit.log({ actor_id: caller.id, club_id: r.club_id, action: 'rental.handover', target_type: 'rental', target_id: id, new_value: { payment_method: dto.payment_method, deposit_held: depositHeld } }, tx);
    });
    const branch = await this.prisma.branches.findUnique({ where: { id: r.branch_id }, select: { timezone: true } });
    await this.after(r, 'RENTAL_HANDED_OVER', { until: fmtWhen(r.end_at, branch?.timezone) });
    return this.detail(id, true, this.fullPhone(caller));
  }

  async returnRental(id: string, dto: ReturnRentalDto, caller: Caller) {
    const r = await this.staffLoad(id, caller);
    if (r.status !== 'ACTIVE') throw new AppException('CONFLICT', `Cannot return a ${r.status} rental`);
    const late = BigInt(dto.late_fee ?? 0);
    const due = r.total_amount + late - r.paid_amount;
    if (due > 0n && (!dto.payment_method || dto.payment_method === 'LATER')) {
      throw new AppException('VALIDATION_ERROR', 'Collect the remaining amount before closing the rental', { field: 'payment_method', amount_due: Number(due) });
    }
    if (r.deposit_status === 'HELD' && !dto.deposit) throw new AppException('VALIDATION_ERROR', 'Choose what happens to the deposit', { field: 'deposit' });
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, ['ACTIVE'], {
        status: 'RETURNED', returned_at: new Date(), returned_by: caller.id, late_fee_amount: late, total_amount: r.total_amount + late,
        ...(r.deposit_status === 'HELD' ? { deposit_status: dto.deposit } : {}),
        ...(dto.note ? { notes: [r.notes, dto.note].filter(Boolean).join('\n') } : {}),
      });
      await this.collect(tx, r, due, dto.payment_method ?? 'LATER', caller.id);
      await this.finance.syncRentalPayment(tx, id);
      await this.audit.log({ actor_id: caller.id, club_id: r.club_id, action: 'rental.return', target_type: 'rental', target_id: id, new_value: { late_fee: Number(late), deposit: dto.deposit ?? null, payment_method: dto.payment_method ?? null } }, tx);
    });
    await this.after(r, 'RENTAL_RETURNED');
    return this.detail(id, true, this.fullPhone(caller));
  }

  // ---------- Fon ishi ----------

  /**
   * Tasdiqlanmagan so'rov (boshlanishdan 30 daq o'tib) va olib ketilmagan arenda (muddatning yarmi, ko'pi bilan 6 soat) — EXPIRED.
   * Tugashiga 1 soat qolganda eslatma, kechiksa mijoz va xodimlarga xabar (dedupe bilan bir marta).
   */
  async sweep() {
    const now = Date.now();
    const stale = await this.prisma.rentals.findMany({ where: { status: { in: ['REQUESTED', 'CONFIRMED'] }, start_at: { lt: new Date(now - 30 * 60_000) } }, take: 200 });
    for (const r of stale) {
      const span = r.end_at.getTime() - r.start_at.getTime();
      const deadline = r.status === 'REQUESTED' ? r.start_at.getTime() + 30 * 60_000 : r.start_at.getTime() + Math.min(span / 2, 6 * 3600_000);
      if (deadline > now) continue;
      const res = await this.prisma.rentals.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'EXPIRED' } });
      if (res.count) await this.after(r, 'RENTAL_EXPIRED');
    }

    const ending = await this.prisma.rentals.findMany({ where: { status: 'ACTIVE', end_at: { gt: new Date(now), lte: new Date(now + 3600_000) } }, take: 200 });
    for (const r of ending) {
      // Qisqa arendada (topshirilganiga 1 soat ham bo'lmagan) eslatma ortiqcha
      if (r.handed_over_at && r.end_at.getTime() - r.handed_over_at.getTime() <= 3600_000) continue;
      const tz = (await this.prisma.branches.findUnique({ where: { id: r.branch_id }, select: { timezone: true } }))?.timezone;
      await this.notifications.notify([r.customer_id], 'RENTAL_ENDING_SOON', { code: r.code, item: (r.item_snapshot as ItemSnapshot).name, until: fmtWhen(r.end_at, tz) }, { rental_id: r.id }, { dedupe_key: `rental-ending:${r.id}` });
    }

    const overdue = await this.prisma.rentals.findMany({ where: { status: 'ACTIVE', end_at: { lt: new Date(now - LATE_GRACE_MINUTES * 60_000) } }, take: 200 });
    for (const r of overdue) {
      const tz = (await this.prisma.branches.findUnique({ where: { id: r.branch_id }, select: { timezone: true } }))?.timezone;
      const vars = { code: r.code, item: (r.item_snapshot as ItemSnapshot).name, until: fmtWhen(r.end_at, tz) };
      await this.notifications.notify([r.customer_id], 'RENTAL_OVERDUE', vars, { rental_id: r.id }, { dedupe_key: `rental-overdue:${r.id}` });
      await this.notifications.notifyClubStaff(r.club_id, r.branch_id, 'RENTAL_OVERDUE_STAFF', vars, { rental_id: r.id }, { dedupe_key: `rental-overdue-staff:${r.id}` });
    }
    return { expired: stale.length };
  }
}
