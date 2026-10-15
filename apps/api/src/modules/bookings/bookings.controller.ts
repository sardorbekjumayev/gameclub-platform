import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor';
import { RbacService } from '../rbac/rbac.service';
import { BookingsService, Caller } from './bookings.service';
import { AvailabilityQuery, BookingListQuery, CancelDto, CreateBookingDto, RescheduleDto, SlotsQuery } from './dto/bookings.dto';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';

const uuid = new ParseUUIDPipe();

@ApiTags('bookings')
@ApiBearerAuth()
@Controller()
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly rbac: RbacService,
  ) {}

  private async caller(u: AuthUser): Promise<Caller> {
    return { id: u.id, grants: await this.rbac.grants(u.id) };
  }

  @RateLimit('public') @Public() @Get('branches/:id/availability') @ApiOperation({ summary: 'Oraliq bo\'yicha qurilmalar holati va narxi' })
  availability(@Param('id', uuid) id: string, @Query() q: AvailabilityQuery) {
    return this.bookings.availability(id, q);
  }

  @RateLimit('public') @Public() @Get('branches/:id/slots') @ApiOperation({ summary: 'Kun bo\'yicha slotlar va bo\'sh qurilmalar soni' })
  slots(@Param('id', uuid) id: string, @Query() q: SlotsQuery) {
    return this.bookings.slots(id, q);
  }

  @RateLimit('write', 'promo') @Post('bookings') @Idempotent() @ApiOperation({ summary: 'Bron yaratish (hold → PENDING_PAYMENT yoki CONFIRMED)' })
  async create(@Body() dto: CreateBookingDto, @CurrentUser() u: AuthUser, @Headers('idempotency-key') key?: string) {
    return this.bookings.create(dto, await this.caller(u), key);
  }

  @Get('bookings') @ApiOperation({ summary: 'Mening bronlarim yoki (staff=true) klub bronlari' })
  async list(@Query() q: BookingListQuery, @CurrentUser() u: AuthUser) {
    return this.bookings.list(q, await this.caller(u));
  }

  @Get('bookings/:id')
  async get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.bookings.get(id, await this.caller(u));
  }

  @Get('bookings/:id/qr')
  async qr(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.bookings.qr(id, await this.caller(u));
  }

  @Get('bookings/:id/timeline')
  async timeline(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.bookings.timeline(id, await this.caller(u));
  }

  @RateLimit('write') @Post('bookings/:id/cancel') @Idempotent()
  async cancel(@Param('id', uuid) id: string, @Body() dto: CancelDto, @CurrentUser() u: AuthUser) {
    return this.bookings.cancel(id, await this.caller(u), dto.reason);
  }

  @RateLimit('write') @Post('bookings/:id/reschedule') @Idempotent()
  async reschedule(@Param('id', uuid) id: string, @Body() dto: RescheduleDto, @CurrentUser() u: AuthUser) {
    return this.bookings.reschedule(id, await this.caller(u), dto);
  }

  @Post('bookings/:id/no-show')
  async noShow(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.bookings.noShow(id, await this.caller(u));
  }
}
