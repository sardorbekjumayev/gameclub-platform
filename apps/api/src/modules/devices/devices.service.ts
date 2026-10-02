import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors';
import { uuidv7 } from '../../common/utils/id';
import { RealtimeService } from '../realtime/realtime.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchesService } from '../clubs/branches.service';
import { Actor } from '../clubs/clubs.service';
import { EntitlementsService } from '../clubs/entitlements.service';
import { assertCan } from '../rbac/access';
import { Grant } from '../rbac/rbac.service';
import {
  BulkDevicesDto, CategoryDto, DeviceDto, DeviceStatusDto, LayoutDto, MaintenanceDto, TariffDto, UpdateDeviceDto, UpdateMaintenanceDto, UpdateTariffDto,
} from './dto/devices.dto';

const LIVE_BOOKING = ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE'];

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branches: BranchesService,
    private readonly entitlements: EntitlementsService,
    private readonly realtime: RealtimeService,
  ) {}

  private async loadDevice(id: string, grants: Grant[], permission: Parameters<typeof assertCan>[1]) {
    const d = await this.prisma.devices.findFirst({ where: { id, deleted_at: null } });
    if (!d) throw new AppException('NOT_FOUND', 'Device not found');
    assertCan(grants, permission, { club_id: d.club_id, branch_id: d.branch_id });
    return d;
  }

  private async assertRefs(branch: { id: string; club_id: string }, roomId?: string | null, categoryId?: string | null) {
    if (roomId && !(await this.prisma.rooms.findFirst({ where: { id: roomId, branch_id: branch.id, deleted_at: null } }))) {
      throw new AppException('VALIDATION_ERROR', 'Room does not belong to this branch', { field: 'room_id' });
    }
    if (categoryId && !(await this.prisma.device_categories.findFirst({ where: { id: categoryId, club_id: branch.club_id, deleted_at: null } }))) {
      throw new AppException('VALIDATION_ERROR', 'Category does not belong to this club', { field: 'category_id' });
    }
  }

  // ---------- Kategoriyalar ----------
  async categories(branchId: string, grants: Grant[] | null) {
    const b = grants ? await this.branches.load(branchId, grants, 'devices.view') : await this.prisma.branches.findFirstOrThrow({ where: { id: branchId } });
    return this.prisma.device_categories.findMany({ where: { club_id: b.club_id, deleted_at: null, OR: [{ branch_id: null }, { branch_id: b.id }] }, orderBy: { position: 'asc' } });
  }

  async createCategory(branchId: string, dto: CategoryDto, grants: Grant[], actor: Actor) {
    const b = await this.branches.load(branchId, grants, 'devices.create');
    const c = await this.prisma.device_categories.create({ data: { id: uuidv7(), club_id: b.club_id, branch_id: b.id, ...dto } });
    await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'device_category.create', target_type: 'device_category', target_id: c.id, new_value: dto });
    return c;
  }

  async updateCategory(id: string, dto: Partial<CategoryDto>, grants: Grant[], actor: Actor) {
    const c = await this.prisma.device_categories.findFirst({ where: { id, deleted_at: null } });
    if (!c) throw new AppException('NOT_FOUND', 'Category not found');
    assertCan(grants, 'devices.update', { club_id: c.club_id, branch_id: c.branch_id });
    const u = await this.prisma.device_categories.update({ where: { id }, data: dto });
    await this.audit.log({ actor_id: actor.id, club_id: c.club_id, action: 'device_category.update', target_type: 'device_category', target_id: id, new_value: dto });
    return u;
  }

  async removeCategory(id: string, grants: Grant[], actor: Actor) {
    const c = await this.prisma.device_categories.findFirst({ where: { id, deleted_at: null } });
    if (!c) throw new AppException('NOT_FOUND', 'Category not found');
    assertCan(grants, 'devices.delete', { club_id: c.club_id, branch_id: c.branch_id });
    await this.prisma.$transaction([
      this.prisma.devices.updateMany({ where: { category_id: id }, data: { category_id: null } }),
      this.prisma.device_categories.update({ where: { id }, data: { deleted_at: new Date() } }),
    ]);
    await this.audit.log({ actor_id: actor.id, club_id: c.club_id, action: 'device_category.delete', target_type: 'device_category', target_id: id });
    return { deleted: true };
  }

  // ---------- Qurilmalar ----------
  async list(branchId: string, grants: Grant[]) {
    await this.branches.load(branchId, grants, 'devices.view');
    return this.prisma.devices.findMany({
      where: { branch_id: branchId, deleted_at: null },
      orderBy: [{ position_order: 'asc' }, { name: 'asc' }],
      include: { room: { select: { id: true, name: true } }, category: { select: { id: true, name: true } }, maintenance: { where: { status: { not: 'DONE' } }, orderBy: { created_at: 'desc' } } },
    });
  }

  /** Ommaviy qisqa ro'yxat (tur, kategoriya, specs). */
  async listPublic(branchId: string) {
    return this.prisma.devices.findMany({
      where: { branch_id: branchId, deleted_at: null, operational_status: { not: 'DISABLED' }, branch: { status: 'ACTIVE', deleted_at: null } },
      orderBy: [{ position_order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, type: true, specs: true, room_id: true, category_id: true, layout: true, operational_status: true },
    });
  }

  async create(branchId: string, dto: DeviceDto, grants: Grant[], actor: Actor) {
    const b = await this.branches.load(branchId, grants, 'devices.create');
    await this.entitlements.assertWithin(b.club_id, 'devices');
    await this.assertRefs(b, dto.room_id, dto.category_id);
    try {
      const d = await this.prisma.devices.create({ data: { id: uuidv7(), club_id: b.club_id, branch_id: b.id, ...dto, specs: dto.specs as Prisma.InputJsonValue } });
      await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'device.create', target_type: 'device', target_id: d.id, new_value: dto, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
      return d;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002' || String((e as Error).message).includes('devices_branch_name_uq')) throw new AppException('CONFLICT', 'Device name already exists in this branch');
      throw e;
    }
  }

  async bulk(branchId: string, dto: BulkDevicesDto, grants: Grant[], actor: Actor) {
    const b = await this.branches.load(branchId, grants, 'devices.create');
    if (dto.to < dto.from) throw new AppException('VALIDATION_ERROR', '"to" must be >= "from"', { field: 'to' });
    const count = dto.to - dto.from + 1;
    if (count > 200) throw new AppException('VALIDATION_ERROR', 'Max 200 devices per request', { field: 'to' });
    await this.assertRefs(b, dto.room_id, dto.category_id);
    const sub = await this.entitlements.current(b.club_id);
    const limit = (sub?.plan.limits as Record<string, number | null> | undefined)?.devices;
    if (limit != null) {
      const used = await this.prisma.devices.count({ where: { club_id: b.club_id, deleted_at: null } });
      if (used + count > limit) throw new AppException('PLAN_LIMIT_REACHED', 'Plan limit reached: devices', { key: 'devices', limit, used });
    }
    const width = String(dto.to).length < 2 ? 2 : String(dto.to).length;
    const names = Array.from({ length: count }, (_, i) => `${dto.prefix}${String(dto.from + i).padStart(width, '0')}`);
    const existing = await this.prisma.devices.findMany({ where: { branch_id: b.id, deleted_at: null, name: { in: names } }, select: { name: true } });
    if (existing.length) throw new AppException('CONFLICT', 'Some device names already exist', { names: existing.map((e) => e.name) });
    const maxPos = await this.prisma.devices.aggregate({ where: { branch_id: b.id }, _max: { position_order: true } });
    await this.prisma.devices.createMany({
      data: names.map((name, i) => ({
        id: uuidv7(), club_id: b.club_id, branch_id: b.id, name, type: dto.type, room_id: dto.room_id, category_id: dto.category_id,
        specs: dto.specs as Prisma.InputJsonValue, position_order: (maxPos._max.position_order ?? 0) + i + 1,
      })),
    });
    await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'device.bulk_create', target_type: 'branch', target_id: b.id, new_value: { names } });
    return { created: names.length, names };
  }

  async update(id: string, dto: UpdateDeviceDto, grants: Grant[], actor: Actor) {
    const d = await this.loadDevice(id, grants, 'devices.update');
    await this.assertRefs({ id: d.branch_id, club_id: d.club_id }, dto.room_id, dto.category_id);
    const u = await this.prisma.devices.update({ where: { id }, data: { ...dto, specs: dto.specs as Prisma.InputJsonValue } });
    await this.audit.log({ actor_id: actor.id, club_id: d.club_id, action: 'device.update', target_type: 'device', target_id: id, new_value: dto, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return u;
  }

  async remove(id: string, grants: Grant[], actor: Actor) {
    const d = await this.loadDevice(id, grants, 'devices.delete');
    const live = await this.prisma.booking_items.count({ where: { device_id: id, active: true, end_at: { gt: new Date() } } });
    const session = await this.prisma.sessions.count({ where: { device_id: id, status: { in: ['WAITING', 'ACTIVE', 'PAUSED'] } } });
    if (live || session) throw new AppException('CONFLICT', 'Device has active bookings or sessions', { bookings: live, sessions: session });
    await this.prisma.devices.update({ where: { id }, data: { deleted_at: new Date() } });
    await this.audit.log({ actor_id: actor.id, club_id: d.club_id, action: 'device.delete', target_type: 'device', target_id: id });
    return { deleted: true };
  }

  /**
   * MAINTENANCE/DISABLED: kelajakdagi bronlar bo'lsa 409 + ro'yxat;
   * `resolve=cancel` bilan bekor qilinadi (refund bookings modulida — cancelHook).
   */
  async setStatus(id: string, dto: DeviceStatusDto, grants: Grant[], actor: Actor, cancelHook: (bookingIds: string[], reason: string) => Promise<void>) {
    const d = await this.loadDevice(id, grants, 'devices.status.change');
    if (dto.operational_status !== 'ACTIVE') {
      const conflicts = await this.prisma.booking_items.findMany({
        where: { device_id: id, active: true, end_at: { gt: new Date() }, booking: { status: { in: LIVE_BOOKING } } },
        select: { booking: { select: { id: true, code: true, start_at: true, end_at: true, status: true } } },
      });
      if (conflicts.length && dto.resolve !== 'cancel') {
        throw new AppException('CONFLICT', 'Device has upcoming bookings', { bookings: conflicts.map((c) => c.booking) });
      }
      if (conflicts.length) await cancelHook(conflicts.map((c) => c.booking.id), dto.reason ?? 'Device unavailable');
    }
    const u = await this.prisma.devices.update({ where: { id }, data: { operational_status: dto.operational_status } });
    await this.audit.log({ actor_id: actor.id, club_id: d.club_id, action: 'device.status', target_type: 'device', target_id: id, old_value: { operational_status: d.operational_status }, new_value: dto, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    this.realtime.branch(d.branch_id, 'device.status.changed', { device_id: id, operational_status: dto.operational_status });
    return u;
  }

  async layout(branchId: string, dto: LayoutDto, grants: Grant[], actor: Actor) {
    const b = await this.branches.load(branchId, grants, 'devices.update');
    const res = await this.prisma.$transaction(
      dto.items.map((i) => this.prisma.devices.updateMany({ where: { id: i.device_id, branch_id: b.id, deleted_at: null }, data: { layout: { x: i.x, y: i.y } } })),
    );
    const skipped = dto.items.filter((_, k) => res[k].count === 0).map((i) => i.device_id);
    await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'branch.layout', target_type: 'branch', target_id: b.id, new_value: { items: dto.items.length, skipped: skipped.length } });
    return { updated: dto.items.length - skipped.length, skipped };
  }

  // ---------- Texnik xizmat ----------
  async maintenanceList(branchId: string, grants: Grant[]) {
    await this.branches.load(branchId, grants, 'devices.view');
    return this.prisma.device_maintenance.findMany({ where: { device: { branch_id: branchId } }, orderBy: { created_at: 'desc' }, take: 200, include: { device: { select: { id: true, name: true } } } });
  }

  async reportMaintenance(deviceId: string, dto: MaintenanceDto, grants: Grant[], actor: Actor) {
    const d = await this.loadDevice(deviceId, grants, 'devices.status.change');
    const m = await this.prisma.device_maintenance.create({ data: { id: uuidv7(), device_id: d.id, club_id: d.club_id, reported_by: actor.id, title: dto.title, description: dto.description } });
    await this.audit.log({ actor_id: actor.id, club_id: d.club_id, action: 'device.maintenance.open', target_type: 'device', target_id: d.id, new_value: dto });
    return m;
  }

  async updateMaintenance(id: string, dto: UpdateMaintenanceDto, grants: Grant[], actor: Actor) {
    const m = await this.prisma.device_maintenance.findUnique({ where: { id }, include: { device: true } });
    if (!m) throw new AppException('NOT_FOUND', 'Maintenance ticket not found');
    assertCan(grants, 'devices.status.change', { club_id: m.club_id, branch_id: m.device.branch_id });
    const u = await this.prisma.device_maintenance.update({
      where: { id },
      data: {
        status: dto.status,
        description: dto.description ?? m.description,
        ...(dto.status === 'IN_PROGRESS' && !m.started_at ? { started_at: new Date() } : {}),
        ...(dto.status === 'DONE' ? { resolved_at: new Date() } : {}),
      },
    });
    await this.audit.log({ actor_id: actor.id, club_id: m.club_id, action: 'device.maintenance.update', target_type: 'device_maintenance', target_id: id, new_value: dto });
    return u;
  }

  // ---------- Tariflar ----------
  async tariffs(branchId: string, grants: Grant[] | null) {
    if (grants) await this.branches.load(branchId, grants, 'tariffs.view');
    return this.prisma.tariffs.findMany({
      where: { branch_id: branchId, deleted_at: null, ...(grants ? {} : { is_active: true }) },
      orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
      include: { rules: true },
    });
  }

  private tariffData(dto: Partial<TariffDto>) {
    const { rules, valid_from, valid_to, price_per_hour, ...rest } = dto;
    void rules;
    return {
      ...rest,
      ...(price_per_hour !== undefined ? { price_per_hour: BigInt(price_per_hour) } : {}),
      ...(valid_from !== undefined ? { valid_from: valid_from ? new Date(valid_from) : null } : {}),
      ...(valid_to !== undefined ? { valid_to: valid_to ? new Date(valid_to) : null } : {}),
    };
  }

  private ruleRows(tariffId: string, rules: TariffDto['rules']) {
    return (rules ?? []).map((r) => ({
      id: uuidv7(), tariff_id: tariffId, days_of_week: r.days_of_week, start_time: r.start_time, end_time: r.end_time,
      price_per_hour: BigInt(r.price_per_hour), kind: r.kind, date: r.date ? new Date(r.date) : null,
    }));
  }

  async createTariff(branchId: string, dto: TariffDto, grants: Grant[], actor: Actor) {
    const b = await this.branches.load(branchId, grants, 'tariffs.create');
    await this.assertRefs(b, dto.room_id, dto.category_id);
    const id = uuidv7();
    const t = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tariffs.create({ data: { ...this.tariffData(dto), id, club_id: b.club_id, branch_id: b.id, name: dto.name, price_per_hour: BigInt(dto.price_per_hour) } });
      if (dto.rules?.length) await tx.tariff_rules.createMany({ data: this.ruleRows(id, dto.rules) });
      return created;
    });
    await this.audit.log({ actor_id: actor.id, club_id: b.club_id, action: 'tariff.create', target_type: 'tariff', target_id: t.id, new_value: dto, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return this.prisma.tariffs.findUnique({ where: { id }, include: { rules: true } });
  }

  async updateTariff(id: string, dto: UpdateTariffDto, grants: Grant[], actor: Actor) {
    const t = await this.prisma.tariffs.findFirst({ where: { id, deleted_at: null }, include: { rules: true } });
    if (!t) throw new AppException('NOT_FOUND', 'Tariff not found');
    assertCan(grants, 'tariffs.update', { club_id: t.club_id, branch_id: t.branch_id });
    await this.prisma.$transaction(async (tx) => {
      await tx.tariffs.update({ where: { id }, data: this.tariffData(dto) });
      if (dto.rules) {
        await tx.tariff_rules.deleteMany({ where: { tariff_id: id } });
        await tx.tariff_rules.createMany({ data: this.ruleRows(id, dto.rules) });
      }
    });
    await this.audit.log({ actor_id: actor.id, club_id: t.club_id, action: 'tariff.update', target_type: 'tariff', target_id: id, old_value: t, new_value: dto, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return this.prisma.tariffs.findUnique({ where: { id }, include: { rules: true } });
  }

  async removeTariff(id: string, grants: Grant[], actor: Actor) {
    const t = await this.prisma.tariffs.findFirst({ where: { id, deleted_at: null } });
    if (!t) throw new AppException('NOT_FOUND', 'Tariff not found');
    assertCan(grants, 'tariffs.delete', { club_id: t.club_id, branch_id: t.branch_id });
    await this.prisma.tariffs.update({ where: { id }, data: { deleted_at: new Date(), is_active: false } });
    await this.audit.log({ actor_id: actor.id, club_id: t.club_id, action: 'tariff.delete', target_type: 'tariff', target_id: id });
    return { deleted: true };
  }
}
