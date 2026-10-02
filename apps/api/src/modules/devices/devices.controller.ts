import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { AuthUser, CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { Grants } from '../../common/decorators/grants.decorator';
import { BookingsService } from '../bookings/bookings.service';
import { PricingService } from '../bookings/pricing.service';
import { type Actor } from '../clubs/clubs.service';
import { type Grant } from '../rbac/rbac.service';
import { AppException } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import {
  BulkDevicesDto, CategoryDto, DeviceDto, DeviceStatusDto, LayoutDto, MaintenanceDto, PriceQuoteDto, RoomTariffDto, TariffDto, UpdateDeviceDto, UpdateMaintenanceDto, UpdateTariffDto,
} from './dto/devices.dto';
import { DevicesService } from './devices.service';

const uuid = new ParseUUIDPipe();

@ApiTags('devices')
@ApiBearerAuth()
@Controller()
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly bookings: BookingsService,
    private readonly pricing: PricingService,
    private readonly prisma: PrismaService,
  ) {}

  // Kategoriyalar
  @Public() @Get('branches/:branchId/device-categories')
  categories(@Param('branchId', uuid) id: string) {
    return this.devices.categories(id, null);
  }
  @Post('branches/:branchId/device-categories') @RequirePermission('devices.create')
  createCategory(@Param('branchId', uuid) id: string, @Body() dto: CategoryDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.createCategory(id, dto, g, a);
  }
  @Patch('device-categories/:id') @RequirePermission('devices.update')
  updateCategory(@Param('id', uuid) id: string, @Body() dto: CategoryDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.updateCategory(id, dto, g, a);
  }
  @Delete('device-categories/:id') @RequirePermission('devices.delete')
  removeCategory(@Param('id', uuid) id: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.removeCategory(id, g, a);
  }

  // Qurilmalar
  @Get('branches/:branchId/devices') @RequirePermission('devices.view')
  list(@Param('branchId', uuid) id: string, @Grants() g: Grant[]) {
    return this.devices.list(id, g);
  }
  @Public() @Get('branches/:branchId/devices/public') @ApiOperation({ summary: 'Ommaviy qurilmalar ro\'yxati (tur, specs)' })
  listPublic(@Param('branchId', uuid) id: string) {
    return this.devices.listPublic(id);
  }
  @Post('branches/:branchId/devices') @RequirePermission('devices.create')
  create(@Param('branchId', uuid) id: string, @Body() dto: DeviceDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.create(id, dto, g, a);
  }
  @Post('branches/:branchId/devices/bulk') @RequirePermission('devices.create') @ApiOperation({ summary: 'PC-01..PC-20 bir zumda' })
  bulk(@Param('branchId', uuid) id: string, @Body() dto: BulkDevicesDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.bulk(id, dto, g, a);
  }
  @Patch('devices/:id') @RequirePermission('devices.update')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateDeviceDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.update(id, dto, g, a);
  }
  @Delete('devices/:id') @RequirePermission('devices.delete')
  remove(@Param('id', uuid) id: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.remove(id, g, a);
  }
  @Patch('devices/:id/status') @RequirePermission('devices.status.change')
  status(@Param('id', uuid) id: string, @Body() dto: DeviceStatusDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.setStatus(id, dto, g, a, (ids, reason) => this.bookings.cancelMany(ids, reason, a.id));
  }
  @Put('branches/:branchId/layout') @RequirePermission('devices.update')
  layout(@Param('branchId', uuid) id: string, @Body() dto: LayoutDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.layout(id, dto, g, a);
  }

  // Texnik xizmat
  @Get('branches/:branchId/maintenance') @RequirePermission('devices.view')
  maintenance(@Param('branchId', uuid) id: string, @Grants() g: Grant[]) {
    return this.devices.maintenanceList(id, g);
  }
  @Post('devices/:id/maintenance') @RequirePermission('devices.status.change')
  report(@Param('id', uuid) id: string, @Body() dto: MaintenanceDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.reportMaintenance(id, dto, g, a);
  }
  @Patch('maintenance/:id') @RequirePermission('devices.status.change')
  updateMaintenance(@Param('id', uuid) id: string, @Body() dto: UpdateMaintenanceDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.updateMaintenance(id, dto, g, a);
  }

  // Tariflar
  @Public() @Get('branches/:branchId/tariffs') @ApiOperation({ summary: 'Tariflar (ommaviy: faol)' })
  tariffsPublic(@Param('branchId', uuid) id: string) {
    return this.devices.tariffs(id, null);
  }
  @Get('branches/:branchId/tariffs/manage') @RequirePermission('tariffs.view')
  tariffs(@Param('branchId', uuid) id: string, @Grants() g: Grant[]) {
    return this.devices.tariffs(id, g);
  }
  @Post('branches/:branchId/tariffs') @RequirePermission('tariffs.create')
  createTariff(@Param('branchId', uuid) id: string, @Body() dto: TariffDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.createTariff(id, dto, g, a);
  }
  @Patch('tariffs/:id') @RequirePermission('tariffs.update')
  updateTariff(@Param('id', uuid) id: string, @Body() dto: UpdateTariffDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.updateTariff(id, dto, g, a);
  }
  @Put('rooms/:id/tariff') @RequirePermission('tariffs.update') @ApiOperation({ summary: 'Xonaga tarif biriktirish (xonadagi barcha o\'rindiqlar shu narxda)' })
  roomTariff(@Param('id', uuid) id: string, @Body() dto: RoomTariffDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.roomTariff(id, dto.tariff_id, g, a);
  }
  @Delete('tariffs/:id') @RequirePermission('tariffs.delete')
  removeTariff(@Param('id', uuid) id: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.devices.removeTariff(id, g, a);
  }

  @Public() @Post('branches/:branchId/price-quote') @ApiOperation({ summary: 'Narx hisoblash (promo bilan)' })
  async quote(@Param('branchId', uuid) branchId: string, @Body() dto: PriceQuoteDto, @CurrentUser() u?: AuthUser) {
    const ctx = await this.bookings.branchCtx(branchId, { requireActive: false });
    const start = new Date(dto.start_at);
    const end = new Date(start.getTime() + dto.duration_minutes * 60_000);
    let devices = dto.device_ids?.length
      ? await this.prisma.devices.findMany({ where: { id: { in: dto.device_ids }, branch_id: branchId, deleted_at: null } })
      : dto.category_id
        ? await this.prisma.devices.findMany({ where: { category_id: dto.category_id, branch_id: branchId, deleted_at: null }, take: 1 })
        : [];
    if (!devices.length) throw new AppException('VALIDATION_ERROR', 'device_ids or category_id is required', {});
    devices = devices.slice(0, 20);
    const tariffs = await this.pricing.tariffs(branchId);
    const items = devices.map((d) => ({ device_id: d.id, name: d.name, ...this.pricing.quoteDevice(tariffs, d, start, end, ctx.branch.timezone) }));
    const subtotal = items.reduce((s, i) => s + i.amount, 0n);
    let discount = 0n;
    let promo: unknown = null;
    if (dto.promo_code) {
      const p = await this.pricing.promo(dto.promo_code, { club_id: ctx.club.id, branch_id: branchId, user_id: u?.id ?? null, subtotal, device_types: devices.map((d) => d.type), start, weekday: start.getDay() || 7 });
      discount = p.discount;
      promo = { code: p.code, discount: p.discount };
    }
    return { items, subtotal, discount, total: subtotal - discount, promo };
  }
}
