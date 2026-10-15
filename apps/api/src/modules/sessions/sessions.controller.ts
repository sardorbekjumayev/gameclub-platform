import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor';
import { Caller } from '../bookings/bookings.service';
import { CheckInDto, ScanDto } from '../bookings/dto/bookings.dto';
import { RbacService } from '../rbac/rbac.service';
import { ActiveQuery, ExtendDto, MoveDto, StartSessionDto, StopDto, WalkInDto } from './dto/sessions.dto';
import { SessionsService } from './sessions.service';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';

const uuid = new ParseUUIDPipe();

@ApiTags('sessions')
@ApiBearerAuth()
@Controller()
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly rbac: RbacService,
  ) {}

  private async caller(u: AuthUser): Promise<Caller> {
    return { id: u.id, grants: await this.rbac.grants(u.id) };
  }

  @Post('bookings/:id/check-in') @RequirePermission('bookings.checkin') @Idempotent()
  async checkIn(@Param('id', uuid) id: string, @Body() dto: CheckInDto, @CurrentUser() u: AuthUser) {
    return this.sessions.checkIn(id, await this.caller(u), dto);
  }

  @RateLimit('sensitive') @Post('bookings/check-in/scan') @RequirePermission('bookings.checkin') @ApiOperation({ summary: 'QR yoki bron kodi bo\'yicha check-in' })
  async scan(@Body() dto: ScanDto, @CurrentUser() u: AuthUser) {
    return this.sessions.scan(dto.qr_payload, await this.caller(u), dto.start_session);
  }

  @Post('bookings/walk-in') @RequirePermission('bookings.create') @Idempotent() @ApiOperation({ summary: 'Walk-in: bron + to\'lov + sessiya' })
  async walkIn(@Body() dto: WalkInDto, @CurrentUser() u: AuthUser) {
    return this.sessions.walkIn(dto, await this.caller(u));
  }

  @Post('sessions') @RequirePermission('sessions.start') @Idempotent() @ApiOperation({ summary: 'Bron bo\'yicha sessiyani boshlash' })
  async start(@Body() dto: StartSessionDto, @CurrentUser() u: AuthUser) {
    return this.sessions.startFromBooking(dto.booking_id, await this.caller(u), dto.device_id);
  }

  @Post('sessions/:id/pause') @RequirePermission('sessions.pause') @Idempotent()
  async pause(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.sessions.pause(id, await this.caller(u));
  }

  @Post('sessions/:id/resume') @RequirePermission('sessions.pause') @Idempotent()
  async resume(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.sessions.resume(id, await this.caller(u));
  }

  @Post('sessions/:id/extend') @RequirePermission('sessions.extend') @Idempotent()
  async extend(@Param('id', uuid) id: string, @Body() dto: ExtendDto, @CurrentUser() u: AuthUser) {
    return this.sessions.extend(id, dto, await this.caller(u));
  }

  @Post('sessions/:id/move') @RequirePermission('sessions.move') @Idempotent()
  async move(@Param('id', uuid) id: string, @Body() dto: MoveDto, @CurrentUser() u: AuthUser) {
    return this.sessions.move(id, dto, await this.caller(u));
  }

  @Post('sessions/:id/stop') @RequirePermission('sessions.stop') @Idempotent()
  async stop(@Param('id', uuid) id: string, @Body() dto: StopDto, @CurrentUser() u: AuthUser) {
    return this.sessions.stop(id, dto, await this.caller(u));
  }

  @Get('sessions/active') @ApiOperation({ summary: 'Faol sessiyalar: o\'zimniki yoki ?branch_id= (xodim)' })
  async active(@Query() q: ActiveQuery, @CurrentUser() u: AuthUser) {
    return this.sessions.active(await this.caller(u), q.branch_id);
  }

  @Get('sessions/:id')
  async get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.sessions.get(id, await this.caller(u));
  }

  @Get('branches/:id/live') @RequirePermission('sessions.view') @ApiOperation({ summary: 'Live board snapshot' })
  async live(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.sessions.live(id, await this.caller(u));
  }
}
