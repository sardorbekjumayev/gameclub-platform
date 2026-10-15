import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { AuthUser, CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { Grants } from '../../common/decorators/grants.decorator';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor';
import { type Actor } from '../clubs/clubs.service';
import { type Grant, RbacService } from '../rbac/rbac.service';
import {
  CancelRentalDto, CreateRentalDto, HandoverDto, RejectRentalDto, RentalItemDto, RentalItemsQuery, RentalListQuery, RentalQuoteQuery, RentalSlotsQuery, ReturnRentalDto, UpdateRentalItemDto,
} from './dto/rentals.dto';
import { Caller, RentalsService } from './rentals.service';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';

const uuid = new ParseUUIDPipe();

@ApiTags('rentals')
@ApiBearerAuth()
@Controller()
export class RentalsController {
  constructor(
    private readonly rentals: RentalsService,
    private readonly rbac: RbacService,
  ) {}

  private async caller(u: AuthUser): Promise<Caller> {
    return { id: u.id, grants: await this.rbac.grants(u.id) };
  }

  // ---------- Ommaviy katalog ----------
  @RateLimit('public') @Public() @Get('rental-items') @ApiOperation({ summary: "Arendaga beriladigan konsollar (barcha faol klublar)" })
  catalog(@Query() q: RentalItemsQuery) {
    return this.rentals.catalog(q);
  }
  @RateLimit('public') @Public() @Get('rental-items/:id')
  item(@Param('id', uuid) id: string) {
    return this.rentals.item(id);
  }
  @RateLimit('public') @Public() @Get('rental-items/:id/quote') @ApiOperation({ summary: "Narx va bo'sh donalar (soatlik/kunlik)" })
  quote(@Param('id', uuid) id: string, @Query() q: RentalQuoteQuery) {
    return this.rentals.quote(id, q);
  }

  @RateLimit('public') @Public() @Get('rental-items/:id/slots') @ApiOperation({ summary: "Kun bo'yicha olib ketish vaqtlari (ish vaqti va bo'sh donalar hisobga olingan)" })
  slots(@Param('id', uuid) id: string, @Query() q: RentalSlotsQuery) {
    return this.rentals.slots(id, q);
  }

  // ---------- Inventar (klub) ----------
  @Get('branches/:branchId/rental-items/manage') @RequirePermission('rentals.view')
  manage(@Param('branchId', uuid) id: string, @Grants() g: Grant[]) {
    return this.rentals.manageList(id, g);
  }
  @Post('branches/:branchId/rental-items') @RequirePermission('rentals.manage')
  createItem(@Param('branchId', uuid) id: string, @Body() dto: RentalItemDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.rentals.createItem(id, dto, g, a);
  }
  @Patch('rental-items/:id') @RequirePermission('rentals.manage')
  updateItem(@Param('id', uuid) id: string, @Body() dto: UpdateRentalItemDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.rentals.updateItem(id, dto, g, a);
  }
  @Delete('rental-items/:id') @RequirePermission('rentals.manage')
  removeItem(@Param('id', uuid) id: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.rentals.removeItem(id, g, a);
  }

  // ---------- Buyurtmalar ----------
  @RateLimit('write') @Post('rentals') @Idempotent() @ApiOperation({ summary: "Arenda so'rovi (REQUESTED — klub tasdiqlaydi)" })
  async create(@Body() dto: CreateRentalDto, @CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.rentals.create(dto, await this.caller(u), key);
  }
  @Get('rentals') @ApiOperation({ summary: 'Mening arendalarim yoki (staff=true) klub arendalari' })
  async list(@Query() q: RentalListQuery, @CurrentUser() u: AuthUser) {
    return this.rentals.list(q, await this.caller(u));
  }
  @Get('rentals/:id')
  async get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.rentals.get(id, await this.caller(u));
  }
  @RateLimit('write') @Post('rentals/:id/cancel') @Idempotent()
  async cancel(@Param('id', uuid) id: string, @Body() dto: CancelRentalDto, @CurrentUser() u: AuthUser) {
    return this.rentals.cancel(id, await this.caller(u), dto.reason);
  }
  @Post('rentals/:id/confirm') @RequirePermission('rentals.process') @Idempotent()
  async confirm(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.rentals.confirm(id, await this.caller(u));
  }
  @Post('rentals/:id/reject') @RequirePermission('rentals.process') @Idempotent()
  async reject(@Param('id', uuid) id: string, @Body() dto: RejectRentalDto, @CurrentUser() u: AuthUser) {
    return this.rentals.reject(id, await this.caller(u), dto.reason);
  }
  @Post('rentals/:id/handover') @RequirePermission('rentals.process') @Idempotent() @ApiOperation({ summary: 'Konsol mijozga topshirildi (to\'lov va garov qayd etiladi)' })
  async handover(@Param('id', uuid) id: string, @Body() dto: HandoverDto, @CurrentUser() u: AuthUser) {
    return this.rentals.handover(id, dto, await this.caller(u));
  }
  @Post('rentals/:id/return') @RequirePermission('rentals.process') @Idempotent() @ApiOperation({ summary: 'Konsol qaytarildi (kechikish haqi, garov)' })
  async returnRental(@Param('id', uuid) id: string, @Body() dto: ReturnRentalDto, @CurrentUser() u: AuthUser) {
    return this.rentals.returnRental(id, dto, await this.caller(u));
  }
}
