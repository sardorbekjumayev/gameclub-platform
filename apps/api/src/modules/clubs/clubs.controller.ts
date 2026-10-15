import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { AuthUser, CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { Grants } from '../../common/decorators/grants.decorator';
import { OptionalReasonDto, PageQuery } from '../../common/dto/pagination.dto';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor';
import { RbacService, type Grant } from '../rbac/rbac.service';
import { BranchesService } from './branches.service';
import { type Actor, ClubsService } from './clubs.service';
import {
  AddStaffDto, AdminCreateClubDto, ClubDocumentDto, ClubListQuery, ClubSettingsDto, CreateBranchDto, CreateClubDto, CreateRoomDto,
  CustomerNoteDto, HoursExceptionDto, InviteStaffDto, ReviewDocumentDto, UpdateBranchDto, UpdateClubDto, UpdateRoomDto, UpdateStaffDto,
} from './dto/clubs.dto';
import { StaffService } from './staff.service';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';

const uuid = new ParseUUIDPipe({ version: undefined });

@ApiTags('clubs')
@ApiBearerAuth()
@Controller()
export class ClubsController {
  constructor(
    private readonly clubs: ClubsService,
    private readonly branches: BranchesService,
    private readonly staff: StaffService,
    private readonly rbac: RbacService,
  ) {}

  // ---------- Ommaviy ----------
  @RateLimit('public') @Public() @Get('clubs') @ApiOperation({ summary: 'ACTIVE klublar' })
  list(@Query() q: PageQuery) {
    return this.clubs.listPublic(q);
  }

  @Get('clubs/mine') @ApiOperation({ summary: 'Men a\'zo bo\'lgan klublar (admin panel)' })
  mine(@CurrentUser() u: AuthUser) {
    return this.clubs.mine(u.id);
  }

  @RateLimit('public') @Public() @Get('clubs/:idOrSlug/public') @ApiOperation({ summary: 'Klub ommaviy sahifasi' })
  getPublic(@Param('idOrSlug') idOrSlug: string) {
    return this.clubs.getPublic(idOrSlug);
  }

  @RateLimit('write') @Post('clubs') @ApiOperation({ summary: 'Klub arizasi (DRAFT); yaratuvchi CLUB_OWNER bo\'ladi' })
  create(@Body() dto: CreateClubDto, @CurrentUser() u: AuthUser, @CurrentActor() a: Actor) {
    return this.clubs.create(u.id, dto, a);
  }

  @Get('clubs/:clubId') @RequirePermission('clubs.view')
  get(@Param('clubId', uuid) id: string, @Grants() g: Grant[]) {
    return this.clubs.get(id, g);
  }

  @Patch('clubs/:clubId') @RequirePermission('clubs.update')
  update(@Param('clubId', uuid) id: string, @Body() dto: UpdateClubDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.clubs.update(id, dto, g, a);
  }

  @Post('clubs/:clubId/submit') @RequirePermission('clubs.update') @ApiOperation({ summary: 'DRAFT/REJECTED → PENDING_APPROVAL' })
  submit(@Param('clubId', uuid) id: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.clubs.submit(id, g, a);
  }

  @Get('clubs/:clubId/settings') @RequirePermission('settings.view')
  settings(@Param('clubId', uuid) id: string, @Grants() g: Grant[]) {
    return this.clubs.settings(id, g);
  }

  @Patch('clubs/:clubId/settings') @RequirePermission('settings.update')
  updateSettings(@Param('clubId', uuid) id: string, @Body() dto: ClubSettingsDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.clubs.updateSettings(id, dto, g, a);
  }

  @Get('clubs/:clubId/documents') @RequirePermission('clubs.documents.manage')
  documents(@Param('clubId', uuid) id: string, @Grants() g: Grant[]) {
    return this.clubs.documents(id, g);
  }

  @Post('clubs/:clubId/documents') @RequirePermission('clubs.documents.manage')
  addDocument(@Param('clubId', uuid) id: string, @Body() dto: ClubDocumentDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.clubs.addDocument(id, dto, g, a);
  }

  // ---------- Filiallar ----------
  @RateLimit('public') @Public() @Get('clubs/:clubId/branches') @ApiOperation({ summary: 'Filiallar (ommaviy: ACTIVE; xodim: hammasi)' })
  async branchList(@Param('clubId', uuid) id: string, @CurrentUser() u?: AuthUser) {
    const grants = u ? await this.rbac.grants(u.id) : null;
    return this.branches.listForClub(id, grants && grants.some((g) => g.permissions.includes('branches.view')) ? grants : null);
  }

  @Post('clubs/:clubId/branches') @RequirePermission('branches.create')
  createBranch(@Param('clubId', uuid) id: string, @Body() dto: CreateBranchDto, @CurrentActor() a: Actor) {
    return this.branches.create(id, dto, a);
  }

  @RateLimit('public') @Public() @Get('branches/:idOrSlug') @ApiOperation({ summary: 'Filial ommaviy sahifasi' })
  branch(@Param('idOrSlug') id: string, @CurrentUser() u?: AuthUser) {
    return this.branches.getPublic(id, u?.id);
  }

  @Patch('branches/:id') @RequirePermission('branches.update')
  updateBranch(@Param('id', uuid) id: string, @Body() dto: UpdateBranchDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.branches.update(id, dto, g, a);
  }

  @Delete('branches/:id') @RequirePermission('branches.delete')
  removeBranch(@Param('id', uuid) id: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.branches.remove(id, g, a);
  }

  @Get('branches/:id/hours-exceptions') @RequirePermission('branches.view')
  exceptions(@Param('id', uuid) id: string, @Grants() g: Grant[]) {
    return this.branches.exceptions(id, g);
  }

  @Post('branches/:id/hours-exceptions') @RequirePermission('branches.update')
  addException(@Param('id', uuid) id: string, @Body() dto: HoursExceptionDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.branches.addException(id, dto, g, a);
  }

  @Delete('branches/:id/hours-exceptions/:exId') @RequirePermission('branches.update')
  removeException(@Param('id', uuid) id: string, @Param('exId', uuid) exId: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.branches.removeException(id, exId, g, a);
  }

  // ---------- Xonalar ----------
  @Get('branches/:branchId/rooms') @RequirePermission('rooms.view')
  rooms(@Param('branchId', uuid) id: string, @Grants() g: Grant[]) {
    return this.branches.rooms(id, g);
  }

  @Post('branches/:branchId/rooms') @RequirePermission('rooms.create')
  createRoom(@Param('branchId', uuid) id: string, @Body() dto: CreateRoomDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.branches.createRoom(id, dto, g, a);
  }

  @Patch('rooms/:id') @RequirePermission('rooms.update')
  updateRoom(@Param('id', uuid) id: string, @Body() dto: UpdateRoomDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.branches.updateRoom(id, dto, g, a);
  }

  @Delete('rooms/:id') @RequirePermission('rooms.delete')
  removeRoom(@Param('id', uuid) id: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.branches.removeRoom(id, g, a);
  }

  // ---------- Xodimlar va mijozlar ----------
  @Get('clubs/:clubId/staff') @RequirePermission('staff.view')
  staffList(@Param('clubId', uuid) id: string, @Grants() g: Grant[]) {
    return this.staff.list(id, g);
  }

  @Post('clubs/:clubId/staff') @RequirePermission('staff.create') @ApiOperation({ summary: 'Xodim qo\'shish (telefon bo\'yicha; yangi bo\'lsa parol bilan yaratiladi)' })
  addStaff(@Param('clubId', uuid) id: string, @Body() dto: AddStaffDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.staff.add(id, dto, g, a);
  }

  @Get('clubs/:clubId/staff/invitations') @RequirePermission('staff.view')
  invitations(@Param('clubId', uuid) id: string, @Grants() g: Grant[]) {
    return this.staff.invitations(id, g);
  }

  @Post('clubs/:clubId/staff/invitations') @RequirePermission('staff.create') @Idempotent() @ApiOperation({ summary: 'Xodimni taklif qilish (SMS havola, 72 soat)' })
  invite(@Param('clubId', uuid) id: string, @Body() dto: InviteStaffDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.staff.invite(id, dto, g, a);
  }

  @Delete('clubs/:clubId/staff/invitations/:invitationId') @RequirePermission('staff.create')
  revokeInvitation(@Param('clubId', uuid) id: string, @Param('invitationId', uuid) iid: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.staff.revokeInvitation(id, iid, g, a);
  }

  @Patch('clubs/:clubId/staff/:assignmentId') @RequirePermission('staff.update')
  updateStaff(@Param('clubId', uuid) id: string, @Param('assignmentId', uuid) sid: string, @Body() dto: UpdateStaffDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.staff.update(id, sid, dto, g, a);
  }

  @Delete('clubs/:clubId/staff/:assignmentId') @RequirePermission('staff.delete')
  removeStaff(@Param('clubId', uuid) id: string, @Param('assignmentId', uuid) sid: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.staff.remove(id, sid, g, a);
  }

  @Get('clubs/:clubId/customers') @RequirePermission('customers.view')
  customers(@Param('clubId', uuid) id: string, @Query() q: PageQuery, @Grants() g: Grant[]) {
    return this.staff.customers(id, q, g);
  }

  @Put('clubs/:clubId/customers/:userId/notes') @RequirePermission('customers.notes.manage')
  note(@Param('clubId', uuid) id: string, @Param('userId', uuid) userId: string, @Body() dto: CustomerNoteDto, @CurrentActor() a: Actor) {
    return this.staff.setNote(id, userId, dto.note, a);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/clubs')
export class AdminClubsController {
  constructor(private readonly clubs: ClubsService) {}

  @Get() @RequirePermission('platform.clubs.approve')
  list(@Query() q: ClubListQuery) {
    return this.clubs.adminList(q);
  }

  @Post() @RequirePermission('platform.clubs.approve') @ApiOperation({ summary: 'Klubni egasi nomidan yaratish' })
  create(@Body() dto: AdminCreateClubDto, @CurrentActor() a: Actor) {
    return this.clubs.adminCreate(dto, a);
  }

  @Get(':id') @RequirePermission('platform.clubs.approve')
  get(@Param('id', uuid) id: string) {
    return this.clubs.adminGet(id);
  }

  @Post(':id/approve') @RequirePermission('platform.clubs.approve')
  approve(@Param('id', uuid) id: string, @Body() dto: OptionalReasonDto, @CurrentActor() a: Actor) {
    return this.clubs.transition(id, 'approve', dto.reason, a);
  }

  @Post(':id/reject') @RequirePermission('platform.clubs.approve')
  reject(@Param('id', uuid) id: string, @Body() dto: OptionalReasonDto, @CurrentActor() a: Actor) {
    return this.clubs.transition(id, 'reject', dto.reason, a);
  }

  @Post(':id/suspend') @RequirePermission('platform.clubs.suspend')
  suspend(@Param('id', uuid) id: string, @Body() dto: OptionalReasonDto, @CurrentActor() a: Actor) {
    return this.clubs.transition(id, 'suspend', dto.reason, a);
  }

  @Post(':id/reactivate') @RequirePermission('platform.clubs.suspend')
  reactivate(@Param('id', uuid) id: string, @Body() dto: OptionalReasonDto, @CurrentActor() a: Actor) {
    return this.clubs.transition(id, 'reactivate', dto.reason, a);
  }

  @Post(':id/close') @RequirePermission('platform.clubs.suspend')
  close(@Param('id', uuid) id: string, @Body() dto: OptionalReasonDto, @CurrentActor() a: Actor) {
    return this.clubs.transition(id, 'close', dto.reason, a);
  }

  @Patch('documents/:docId') @RequirePermission('platform.clubs.approve')
  reviewDocument(@Param('docId', uuid) id: string, @Body() dto: ReviewDocumentDto, @CurrentActor() a: Actor) {
    return this.clubs.reviewDocument(id, dto, a);
  }
}
