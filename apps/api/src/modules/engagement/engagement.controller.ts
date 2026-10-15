import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { AuthUser, CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { Grants } from '../../common/decorators/grants.decorator';
import { PageQuery } from '../../common/dto/pagination.dto';
import { type Actor } from '../clubs/clubs.service';
import { RbacService, type Grant } from '../rbac/rbac.service';
import {
  AdminPromotionQuery, AnnouncementDto, CreateReviewDto, CreateTicketDto, DeviceTokenDto, ModerateReviewDto, NotificationPrefsDto, NotificationQuery, PromotionDto, ReplyDto, ReviewListQuery,
  SocialSettingsDto, StaffReviewQuery, TicketListQuery, TicketMessageDto, UpdatePromotionDto, UpdateReviewDto, UpdateTicketDto, ValidatePromoDto,
} from './engagement.dto';
import { EngagementService } from './engagement.service';
import { NotificationsService } from '../notifications/notifications.service';

const uuid = new ParseUUIDPipe();

@ApiTags('engagement')
@ApiBearerAuth()
@Controller()
export class EngagementController {
  constructor(
    private readonly svc: EngagementService,
    private readonly rbac: RbacService,
    private readonly notif: NotificationsService,
  ) {}

  // ---- Sharhlar ----
  @Post('reviews') @ApiOperation({ summary: 'Sharh (faqat COMPLETED bron, bittadan)' })
  createReview(@Body() dto: CreateReviewDto, @CurrentUser() u: AuthUser) {
    return this.svc.createReview(u.id, dto);
  }
  @Get('reviews/mine')
  myReviews(@CurrentUser() u: AuthUser) {
    return this.svc.myReviews(u.id);
  }
  @Patch('reviews/:id')
  updateReview(@Param('id', uuid) id: string, @Body() dto: UpdateReviewDto, @CurrentUser() u: AuthUser) {
    return this.svc.updateReview(u.id, id, dto);
  }
  @Delete('reviews/:id')
  deleteReview(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.svc.deleteReview(u.id, id);
  }
  @Public() @Get('branches/:id/reviews')
  branchReviews(@Param('id', uuid) id: string, @Query() q: ReviewListQuery) {
    return this.svc.branchReviews(id, q);
  }
  @Get('clubs/:clubId/reviews') @RequirePermission('reviews.view')
  clubReviews(@Param('clubId', uuid) id: string, @Query() q: StaffReviewQuery, @Grants() g: Grant[]) {
    return this.svc.staffReviews(id, q, g);
  }
  @Post('reviews/:id/reply') @RequirePermission('reviews.reply')
  reply(@Param('id', uuid) id: string, @Body() dto: ReplyDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.svc.reply(id, dto.text, g, a);
  }
  @Post('reviews/:id/report')
  report(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.svc.report(id, u.id);
  }
  @Get('admin/reviews') @RequirePermission('platform.reviews.moderate')
  adminReviews(@Query() q: StaffReviewQuery) {
    return this.svc.adminReviews(q);
  }
  @Patch('admin/reviews/:id') @RequirePermission('platform.reviews.moderate')
  moderate(@Param('id', uuid) id: string, @Body() dto: ModerateReviewDto, @CurrentActor() a: Actor) {
    return this.svc.moderate(id, dto.status, dto.note, a);
  }

  // ---- Sevimlilar ----
  @Get('favorites')
  favorites(@CurrentUser() u: AuthUser) {
    return this.svc.favorites(u.id);
  }
  @Put('favorites/:branchId')
  addFavorite(@Param('branchId', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.svc.addFavorite(u.id, id);
  }
  @Delete('favorites/:branchId')
  removeFavorite(@Param('branchId', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.svc.removeFavorite(u.id, id);
  }

  // ---- Support ----
  @Post('support/tickets')
  async createTicket(@Body() dto: CreateTicketDto, @CurrentUser() u: AuthUser) {
    return this.svc.createTicket(u.id, dto, await this.rbac.grants(u.id));
  }
  @Get('admin/support/stats') @RequirePermission('platform.tickets.manage') @ApiOperation({ summary: 'Javob kutayotgan / ochiq murojaatlar soni' })
  ticketStats() {
    return this.svc.ticketStats();
  }
  @Get('support/tickets') @ApiOperation({ summary: 'O\'z murojaatlarim; platforma xodimi ?all=true' })
  async tickets(@Query() q: TicketListQuery, @CurrentUser() u: AuthUser) {
    return this.svc.tickets(u.id, q, await this.rbac.grants(u.id));
  }
  @Get('support/tickets/:id')
  async ticket(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.svc.ticket(id, u.id, await this.rbac.grants(u.id));
  }
  @Post('support/tickets/:id/messages')
  async message(@Param('id', uuid) id: string, @Body() dto: TicketMessageDto, @CurrentUser() u: AuthUser) {
    return this.svc.addMessage(id, u.id, dto.body, await this.rbac.grants(u.id));
  }
  @Patch('admin/support/tickets/:id') @RequirePermission('platform.tickets.manage')
  updateTicket(@Param('id', uuid) id: string, @Body() dto: UpdateTicketDto, @CurrentActor() a: Actor) {
    return this.svc.updateTicket(id, dto, a);
  }

  // ---- Bildirishnomalar ----
  @Get('notifications')
  notifications(@Query() q: NotificationQuery, @CurrentUser() u: AuthUser) {
    return this.svc.notificationsList(u.id, q);
  }
  @Get('notifications/unread-count')
  unread(@CurrentUser() u: AuthUser) {
    return this.svc.unread(u.id);
  }
  @Patch('notifications/:id/read')
  read(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.svc.markRead(u.id, id);
  }
  @Post('notifications/read-all')
  readAll(@CurrentUser() u: AuthUser) {
    return this.svc.markAllRead(u.id);
  }
  @Get('users/me/notification-preferences') @ApiOperation({ summary: 'Bildirishnoma sozlamalari' })
  prefs(@CurrentUser() u: AuthUser) {
    return this.notif.getPrefs(u.id);
  }
  @Patch('users/me/notification-preferences') @ApiOperation({ summary: 'Bildirishnoma sozlamalarini yangilash' })
  updatePrefs(@Body() dto: NotificationPrefsDto, @CurrentUser() u: AuthUser) {
    return this.notif.updatePrefs(u.id, dto);
  }
  @Post('users/me/device-tokens')
  token(@Body() dto: DeviceTokenDto, @CurrentUser() u: AuthUser) {
    return this.svc.registerDeviceToken(u.id, dto.token, dto.platform, dto.app_version);
  }
  @Delete('users/me/device-tokens/:token')
  removeToken(@Param('token') token: string, @CurrentUser() u: AuthUser) {
    return this.svc.removeDeviceToken(u.id, token);
  }

  // ---- E'lonlar ----
  @Public() @Get('announcements') @ApiOperation({ summary: 'Platforma e\'lonlari' })
  platformAnnouncements() {
    return this.svc.announcements(null);
  }
  @Public() @Get('clubs/:clubId/announcements')
  clubAnnouncements(@Param('clubId', uuid) id: string) {
    return this.svc.announcements(id);
  }
  @Post('clubs/:clubId/announcements') @RequirePermission('announcements.manage')
  createClubAnnouncement(@Param('clubId', uuid) id: string, @Body() dto: AnnouncementDto, @CurrentActor() a: Actor) {
    return this.svc.createAnnouncement(id, dto, a);
  }
  @Delete('clubs/:clubId/announcements/:id') @RequirePermission('announcements.manage')
  deleteClubAnnouncement(@Param('clubId', uuid) clubId: string, @Param('id', uuid) id: string, @CurrentActor() a: Actor) {
    return this.svc.deleteAnnouncement(id, clubId, a);
  }
  @Post('admin/broadcasts') @RequirePermission('platform.announcements.manage')
  broadcast(@Body() dto: AnnouncementDto, @CurrentActor() a: Actor) {
    return this.svc.createAnnouncement(null, dto, a);
  }
  @Delete('admin/broadcasts/:id') @RequirePermission('platform.announcements.manage')
  deleteBroadcast(@Param('id', uuid) id: string, @CurrentActor() a: Actor) {
    return this.svc.deleteAnnouncement(id, null, a);
  }

  // ---- Promo kodlar ----
  @Get('clubs/:clubId/promotions') @RequirePermission('promotions.view')
  promotions(@Param('clubId', uuid) id: string, @Query() q: PageQuery) {
    return this.svc.promotions(id, q);
  }
  @Post('clubs/:clubId/promotions') @RequirePermission('promotions.manage')
  createPromotion(@Param('clubId', uuid) id: string, @Body() dto: PromotionDto, @CurrentActor() a: Actor) {
    return this.svc.createPromotion(id, dto, a);
  }
  // ---- Ijtimoiy tarmoqlar (mijozlarga "obuna bo'ling" taklifi) ----
  @Public() @Get('social') @ApiOperation({ summary: 'Platformaning ijtimoiy tarmoq havolalari va taklif bannerini ko\'rsatish' })
  social() {
    return this.svc.social();
  }
  @Get('admin/settings/social') @RequirePermission('platform.settings.manage')
  adminSocial() {
    return this.svc.social();
  }
  @Put('admin/settings/social') @RequirePermission('platform.settings.manage') @ApiOperation({ summary: 'Ijtimoiy tarmoq havolalari (bo\'sh — o\'chirish); audit' })
  setSocial(@Body() dto: SocialSettingsDto, @CurrentActor() a: Actor) {
    return this.svc.setSocial(dto, a);
  }
  @Get('admin/promotions') @RequirePermission('platform.settings.manage')
  @ApiOperation({ summary: "Super admin: platforma va klublar promo kodlari (scope=PLATFORM|CLUBS|ALL, club_id)" })
  platformPromotions(@Query() q: AdminPromotionQuery) {
    return this.svc.adminPromotions(q);
  }
  @Post('admin/promotions') @RequirePermission('platform.settings.manage')
  createPlatformPromotion(@Body() dto: PromotionDto, @CurrentActor() a: Actor) {
    return this.svc.createPromotion(null, dto, a);
  }
  @Patch('promotions/:id')
  async updatePromotion(@Param('id', uuid) id: string, @Body() dto: UpdatePromotionDto, @CurrentUser() u: AuthUser, @CurrentActor() a: Actor) {
    return this.svc.updatePromotion(id, dto, await this.rbac.grants(u.id), a);
  }
  @Delete('promotions/:id')
  async deletePromotion(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @CurrentActor() a: Actor) {
    return this.svc.deletePromotion(id, await this.rbac.grants(u.id), a);
  }
  @Post('promotions/validate')
  validate(@Body() dto: ValidatePromoDto, @CurrentUser() u: AuthUser) {
    return this.svc.validatePromo(u.id, dto.code, dto.branch_id, dto.amount, dto.start_at, dto.device_ids);
  }
}
