import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { policyFrom } from '../../common/domain/price-engine';
import { DEFAULT_WORKING_HOURS, openState, validateWorkingHours, WorkingHours } from '../../common/domain/working-hours';
import { AppException } from '../../common/errors';
import { slugify } from '../../common/utils/codes';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertCan, branchesInClub } from '../rbac/access';
import { Grant } from '../rbac/rbac.service';
import { Actor, PUBLIC_CLUB_SELECT } from './clubs.service';
import { CreateBranchDto, CreateRoomDto, HoursExceptionDto, UpdateBranchDto, UpdateRoomDto } from './dto/clubs.dto';
import { EntitlementsService } from './entitlements.service';

/** docs/01-API.md §6.3 booking_settings default qiymatlari. */
export const DEFAULT_BOOKING_SETTINGS = {
  slot_minutes: 30,
  buffer_minutes: 0,
  min_advance_minutes: 0,
  max_advance_days: 14,
  hold_minutes: 10,
  early_checkin_minutes: 15,
  grace_minutes: 15,
  allow_category_booking: true,
  allow_specific_device: true,
  auto_no_show: true,
  /** VIP / ochiq vaqt: kamida shuncha daqiqa to'lanadi */
  open_min_minutes: 30,
  /** VIP / ochiq vaqt: o'ynalgan vaqt shu qadamga yuqoriga yaxlitlanadi (1 — daqiqama-daqiqa) */
  open_round_minutes: 5,
};
export type BookingSettings = typeof DEFAULT_BOOKING_SETTINGS;
export const bookingSettings = (b: { booking_settings: unknown }): BookingSettings => ({ ...DEFAULT_BOOKING_SETTINGS, ...((b.booking_settings as object) ?? {}) });

/** DTO instansiyasidagi berilmagan (undefined) maydonlar mavjud qiymatlarni o'chirib yubormasin. */
const definedOnly = <T extends object>(o: T | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Bezaklarni toza JSON qilib saqlash (faqat kind/x/y). */
const roomData = <T extends CreateRoomDto>(dto: T) => {
  const { decor, ...rest } = dto;
  return { ...rest, ...(decor ? { decor: decor.map(({ kind, x, y }) => ({ kind, x, y })) } : {}) };
};

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Filialni topish + scope tekshiruvi. Boshqa klubniki bo'lsa 404. */
  async load(branchId: string, grants: Grant[], permission: Parameters<typeof assertCan>[1]) {
    const b = await this.prisma.branches.findFirst({ where: { id: branchId, deleted_at: null } });
    if (!b) throw new AppException('NOT_FOUND', 'Branch not found');
    assertCan(grants, permission, { club_id: b.club_id, branch_id: b.id });
    return b;
  }

  async listForClub(clubId: string, grants: Grant[] | null) {
    // Ommaviy: faqat ACTIVE; xodim: hammasi (o'z filiallari)
    const allowed = grants ? branchesInClub(grants, 'branches.view', clubId) : undefined;
    const staff = grants && (allowed === null || (allowed && allowed.length > 0));
    const rows = await this.prisma.branches.findMany({
      where: {
        club_id: clubId,
        deleted_at: null,
        ...(staff ? (allowed ? { id: { in: allowed } } : {}) : { status: 'ACTIVE', club: { status: 'ACTIVE' } }),
      },
      orderBy: { created_at: 'asc' },
      include: { _count: { select: { devices: { where: { deleted_at: null } }, rooms: { where: { deleted_at: null } } } } },
    });
    return rows.map((b) => ({ ...b, booking_settings: bookingSettings(b), ...openState(b.working_hours as WorkingHours, [], b.timezone) }));
  }

  async create(clubId: string, dto: CreateBranchDto, actor: Actor) {
    const club = await this.prisma.clubs.findFirst({ where: { id: clubId, deleted_at: null } });
    if (!club) throw new AppException('NOT_FOUND', 'Club not found');
    await this.entitlements.assertWithin(clubId, 'branches');
    const wh = dto.working_hours ?? DEFAULT_WORKING_HOURS;
    if (!validateWorkingHours(wh)) throw new AppException('VALIDATION_ERROR', 'Invalid working_hours', { field: 'working_hours' });
    let slug = slugify(dto.name);
    if (await this.prisma.branches.findFirst({ where: { club_id: clubId, slug } })) slug = `${slug}-${uuidv7().slice(-4)}`;
    const branch = await this.prisma.branches.create({
      data: {
        id: uuidv7(),
        club_id: clubId,
        name: dto.name,
        slug,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        phone: dto.phone,
        description: dto.description,
        cover_url: dto.cover_url,
        images: dto.images ?? [],
        amenities: dto.amenities ?? [],
        working_hours: wh as Prisma.InputJsonValue,
        booking_settings: { ...DEFAULT_BOOKING_SETTINGS, ...definedOnly(dto.booking_settings) },
      },
    });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'branch.create', target_type: 'branch', target_id: branch.id, new_value: dto, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return branch;
  }

  async update(branchId: string, dto: UpdateBranchDto, grants: Grant[], actor: Actor) {
    const old = await this.load(branchId, grants, 'branches.update');
    if (dto.working_hours && !validateWorkingHours(dto.working_hours)) throw new AppException('VALIDATION_ERROR', 'Invalid working_hours', { field: 'working_hours' });
    const { booking_settings, working_hours, ...rest } = dto;
    const b = await this.prisma.branches.update({
      where: { id: branchId },
      data: {
        ...rest,
        ...(working_hours ? { working_hours: working_hours as Prisma.InputJsonValue } : {}),
        ...(booking_settings ? { booking_settings: { ...bookingSettings(old), ...definedOnly(booking_settings) } } : {}),
      },
    });
    let warning: { future_bookings: number } | undefined;
    if (dto.status && dto.status !== 'ACTIVE') {
      const future = await this.prisma.bookings.count({ where: { branch_id: branchId, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] }, start_at: { gt: new Date() } } });
      if (future) warning = { future_bookings: future };
    }
    await this.audit.log({ actor_id: actor.id, club_id: old.club_id, action: 'branch.update', target_type: 'branch', target_id: branchId, old_value: Object.fromEntries(Object.keys(dto).map((k) => [k, (old as Record<string, unknown>)[k]])), new_value: dto, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return { ...b, warning };
  }

  async remove(branchId: string, grants: Grant[], actor: Actor) {
    const b = await this.load(branchId, grants, 'branches.delete');
    const active = await this.prisma.bookings.count({ where: { branch_id: branchId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE'] } } });
    if (active) throw new AppException('CONFLICT', 'Branch has active bookings', { active_bookings: active });
    await this.prisma.branches.update({ where: { id: branchId }, data: { deleted_at: new Date(), status: 'INACTIVE' } });
    await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'branch.delete', target_type: 'branch', target_id: branchId, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return { deleted: true };
  }

  /** Ommaviy filial sahifasi: klub, xonalar, qurilma turlari, ish vaqti, reyting. */
  async getPublic(idOrSlug: string, userId?: string) {
    const isId = /^[0-9a-f-]{36}$/.test(idOrSlug);
    const b = await this.prisma.branches.findFirst({
      where: { ...(isId ? { id: idOrSlug } : { slug: idOrSlug }), deleted_at: null, status: 'ACTIVE', club: { status: 'ACTIVE', deleted_at: null } },
      include: {
        club: { select: { ...PUBLIC_CLUB_SELECT, cancellation_policy: true, settings: true, transfer_card_number: true, transfer_link_url: true } },
        rooms: { where: { deleted_at: null, status: 'ACTIVE' }, orderBy: { position: 'asc' }, select: { id: true, name: true, type: true, capacity: true, description: true } },
        exceptions: { where: { date: { gte: new Date(Date.now() - 86400_000) } }, orderBy: { date: 'asc' } },
      },
    });
    if (!b) throw new AppException('NOT_FOUND', 'Branch not found');
    // Karta raqami ommaviy sahifada ko'rinmaydi — faqat "kartaga o'tkazma mumkin" belgisi
    const { transfer_card_number, transfer_link_url, settings, cancellation_policy, ...club } = b.club;
    const payment_options = { card_transfer: !!transfer_card_number || !!transfer_link_url, pay_at_club: (settings as { allow_pay_at_club?: boolean } | null)?.allow_pay_at_club !== false };
    const [devices, categories, minTariff] = await Promise.all([
      this.prisma.devices.groupBy({ by: ['type'], where: { branch_id: b.id, deleted_at: null, operational_status: 'ACTIVE' }, _count: true }),
      this.prisma.device_categories.findMany({ where: { club_id: b.club_id, deleted_at: null, OR: [{ branch_id: null }, { branch_id: b.id }] }, orderBy: { position: 'asc' } }),
      this.prisma.tariffs.aggregate({ where: { branch_id: b.id, deleted_at: null, is_active: true }, _min: { price_per_hour: true } }),
    ]);
    return {
      ...b,
      club,
      cancellation_policy: policyFrom(cancellation_policy),
      payment_options,
      booking_settings: bookingSettings(b),
      ...openState(b.working_hours as WorkingHours, b.exceptions, b.timezone),
      device_types: devices.map((d) => ({ type: d.type, count: d._count })),
      categories,
      min_price_per_hour: minTariff._min.price_per_hour ?? null,
      is_favorite: userId ? !!(await this.prisma.favorites.findUnique({ where: { user_id_branch_id: { user_id: userId, branch_id: b.id } } })) : false,
    };
  }

  async exceptions(branchId: string, grants: Grant[]) {
    await this.load(branchId, grants, 'branches.view');
    return this.prisma.branch_hours_exceptions.findMany({ where: { branch_id: branchId }, orderBy: { date: 'asc' } });
  }

  async addException(branchId: string, dto: HoursExceptionDto, grants: Grant[], actor: Actor) {
    const b = await this.load(branchId, grants, 'branches.update');
    if (!dto.is_closed && (!dto.open_time || !dto.close_time)) throw new AppException('VALIDATION_ERROR', 'open_time and close_time are required', {});
    const date = new Date(`${dto.date}T00:00:00Z`);
    const ex = await this.prisma.branch_hours_exceptions.upsert({
      where: { branch_id_date: { branch_id: branchId, date } },
      update: { is_closed: dto.is_closed, open_time: dto.open_time, close_time: dto.close_time, reason: dto.reason },
      create: { id: uuidv7(), branch_id: branchId, date, is_closed: dto.is_closed, open_time: dto.open_time, close_time: dto.close_time, reason: dto.reason },
    });
    await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'branch.hours_exception.set', target_type: 'branch', target_id: branchId, new_value: dto });
    return ex;
  }

  async removeException(branchId: string, exceptionId: string, grants: Grant[], actor: Actor) {
    const b = await this.load(branchId, grants, 'branches.update');
    await this.prisma.branch_hours_exceptions.deleteMany({ where: { id: exceptionId, branch_id: branchId } });
    await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'branch.hours_exception.delete', target_type: 'branch', target_id: branchId });
    return { deleted: true };
  }

  // ---------- Rooms ----------

  async rooms(branchId: string, grants: Grant[]) {
    await this.load(branchId, grants, 'rooms.view');
    return this.prisma.rooms.findMany({
      where: { branch_id: branchId, deleted_at: null },
      orderBy: { position: 'asc' },
      include: { _count: { select: { devices: { where: { deleted_at: null } } } } },
    });
  }

  async createRoom(branchId: string, dto: CreateRoomDto, grants: Grant[], actor: Actor) {
    const b = await this.load(branchId, grants, 'rooms.create');
    const room = await this.prisma.rooms.create({ data: { id: uuidv7(), branch_id: branchId, club_id: b.club_id, ...roomData(dto) } });
    await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'room.create', target_type: 'room', target_id: room.id, new_value: dto });
    return room;
  }

  private async loadRoom(roomId: string, grants: Grant[], permission: Parameters<typeof assertCan>[1]) {
    const r = await this.prisma.rooms.findFirst({ where: { id: roomId, deleted_at: null } });
    if (!r) throw new AppException('NOT_FOUND', 'Room not found');
    assertCan(grants, permission, { club_id: r.club_id, branch_id: r.branch_id });
    return r;
  }

  async updateRoom(roomId: string, dto: UpdateRoomDto, grants: Grant[], actor: Actor) {
    const r = await this.loadRoom(roomId, grants, 'rooms.update');
    const room = await this.prisma.rooms.update({ where: { id: roomId }, data: roomData(dto) });
    await this.audit.log({ actor_id: actor.id, club_id: r.club_id, action: 'room.update', target_type: 'room', target_id: roomId, new_value: dto });
    return room;
  }

  async removeRoom(roomId: string, grants: Grant[], actor: Actor) {
    const r = await this.loadRoom(roomId, grants, 'rooms.delete');
    const devices = await this.prisma.devices.count({ where: { room_id: roomId, deleted_at: null } });
    if (devices) throw new AppException('CONFLICT', 'Room has devices', { devices });
    await this.prisma.rooms.update({ where: { id: roomId }, data: { deleted_at: new Date() } });
    await this.audit.log({ actor_id: actor.id, club_id: r.club_id, action: 'room.delete', target_type: 'room', target_id: roomId });
    return { deleted: true };
  }
}
