import { DateTime } from 'luxon';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PageQuery, pageArgs } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingService } from '../bookings/pricing.service';
import { Actor } from '../clubs/clubs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertCan, branchesInClub, can, clubScopeWhere, scopeFilter } from '../rbac/access';
import { Grant } from '../rbac/rbac.service';
import {
  AnnouncementDto, CreateReviewDto, CreateTicketDto, NotificationQuery, PromotionDto, ReviewListQuery, StaffReviewQuery, TicketListQuery, UpdatePromotionDto,
  UpdateReviewDto, UpdateTicketDto,
} from './engagement.dto';

/** Sharh matnidan telefon/havolalarni olib tashlash (spam filtri, §6.13). */
const sanitize = (t?: string) =>
  t?.replace(/<[^>]*>/g, '').replace(/(https?:\/\/|www\.)\S+/gi, '[link]').replace(/\+?\d[\d\s-]{8,}\d/g, '[phone]').trim();

@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly pricing: PricingService,
  ) {}

  // ================= Sharhlar =================

  private async recalc(tx: Prisma.TransactionClient, clubId: string, branchId: string) {
    for (const [table, where] of [['branch', { branch_id: branchId }], ['club', { club_id: clubId }]] as const) {
      const agg = await tx.reviews.aggregate({ where: { ...where, status: 'VISIBLE' }, _avg: { rating: true }, _count: true });
      const data = { rating_avg: new Prisma.Decimal((agg._avg.rating ?? 0).toFixed(2)), rating_count: agg._count };
      if (table === 'branch') await tx.branches.update({ where: { id: branchId }, data });
      else await tx.clubs.update({ where: { id: clubId }, data });
    }
  }

  async createReview(userId: string, dto: CreateReviewDto) {
    const b = await this.prisma.bookings.findFirst({ where: { id: dto.booking_id, customer_id: userId } });
    if (!b) throw new AppException('NOT_FOUND', 'Booking not found');
    if (b.status !== 'COMPLETED') throw new AppException('CONFLICT', 'Only completed bookings can be reviewed');
    if (await this.prisma.reviews.findUnique({ where: { booking_id: b.id } })) throw new AppException('CONFLICT', 'Booking already reviewed');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.reviews.create({ data: { id: uuidv7(), user_id: userId, club_id: b.club_id, branch_id: b.branch_id, booking_id: b.id, rating: dto.rating, text: sanitize(dto.text) } });
      await this.recalc(tx, b.club_id, b.branch_id);
      return r;
    });
  }

  async updateReview(userId: string, id: string, dto: UpdateReviewDto) {
    const r = await this.prisma.reviews.findFirst({ where: { id, user_id: userId } });
    if (!r) throw new AppException('NOT_FOUND', 'Review not found');
    if (Date.now() - r.created_at.getTime() > 24 * 3600_000) throw new AppException('CONFLICT', 'Reviews can be edited within 24 hours');
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.reviews.update({ where: { id }, data: { rating: dto.rating, text: dto.text !== undefined ? sanitize(dto.text) : undefined } });
      await this.recalc(tx, r.club_id, r.branch_id);
      return u;
    });
  }

  async deleteReview(userId: string, id: string) {
    const r = await this.prisma.reviews.findFirst({ where: { id, user_id: userId } });
    if (!r) throw new AppException('NOT_FOUND', 'Review not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.reviews.delete({ where: { id } });
      await this.recalc(tx, r.club_id, r.branch_id);
    });
    return { deleted: true };
  }

  private async withAuthors<T extends { user_id: string }>(rows: T[]) {
    const users = await this.prisma.users.findMany({ where: { id: { in: rows.map((r) => r.user_id) } }, select: { id: true, first_name: true, last_name: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => {
      const u = byId.get(r.user_id);
      return { ...r, author: u ? `${u.first_name ?? ''} ${u.last_name ? u.last_name[0] + '.' : ''}`.trim() || null : null };
    });
  }

  async branchReviews(branchId: string, q: ReviewListQuery) {
    const where: Prisma.reviewsWhereInput = { branch_id: branchId, status: 'VISIBLE' };
    const [rows, total, dist] = await Promise.all([
      this.prisma.reviews.findMany({ where, orderBy: q.sort === 'rating' ? [{ rating: 'desc' }, { created_at: 'desc' }] : { created_at: 'desc' }, ...pageArgs(q) }),
      this.prisma.reviews.count({ where }),
      this.prisma.reviews.groupBy({ by: ['rating'], where, _count: true }),
    ]);
    return new Paginated(await this.withAuthors(rows), { page: q.page, limit: q.limit, total, distribution: Object.fromEntries(dist.map((d) => [d.rating, d._count])) });
  }

  async myReviews(userId: string) {
    const rows = await this.prisma.reviews.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' }, take: 200 });
    const branches = await this.prisma.branches.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.branch_id))] } }, select: { id: true, name: true, club: { select: { name: true } } } });
    const br = new Map(branches.map((b) => [b.id, b]));
    return rows.map((r) => ({ ...r, branch_name: br.get(r.branch_id)?.name ?? null, club_name: br.get(r.branch_id)?.club.name ?? null, can_edit: Date.now() - r.created_at.getTime() <= 24 * 3600_000 }));
  }

  async staffReviews(clubId: string, q: StaffReviewQuery, grants: Grant[]) {
    const allowed = branchesInClub(grants, 'reviews.view', clubId);
    // Filial filtri ruxsat etilgan filiallar ichida bo'lishi shart (scope)
    if (q.branch_id && allowed && !allowed.includes(q.branch_id)) throw new AppException('NOT_FOUND', 'Branch not found');
    const where: Prisma.reviewsWhereInput = {
      club_id: clubId,
      ...(allowed ? { branch_id: { in: allowed } } : {}),
      ...(q.branch_id ? { branch_id: q.branch_id } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.unanswered === 'true' ? { reply_text: null } : {}),
    };
    const [rows, total] = await Promise.all([this.prisma.reviews.findMany({ where, orderBy: { created_at: 'desc' }, ...pageArgs(q) }), this.prisma.reviews.count({ where })]);
    return new Paginated(await this.withAuthors(rows), { page: q.page, limit: q.limit, total });
  }

  async reply(id: string, text: string, grants: Grant[], actor: Actor) {
    const r = await this.prisma.reviews.findUnique({ where: { id } });
    if (!r) throw new AppException('NOT_FOUND', 'Review not found');
    assertCan(grants, 'reviews.reply', { club_id: r.club_id, branch_id: r.branch_id });
    const u = await this.prisma.reviews.update({ where: { id }, data: { reply_text: sanitize(text), replied_at: new Date() } });
    await this.audit.log({ actor_id: actor.id, club_id: r.club_id, action: 'review.reply', target_type: 'review', target_id: id });
    const club = await this.prisma.clubs.findUnique({ where: { id: r.club_id }, select: { name: true } });
    await this.notifications.notify([r.user_id], 'REVIEW_REPLY', { club: club?.name ?? '', reply: (u.reply_text ?? '').slice(0, 120) }, { review_id: id });
    return u;
  }

  async report(id: string, userId: string) {
    const r = await this.prisma.reviews.findUnique({ where: { id } });
    if (!r) throw new AppException('NOT_FOUND', 'Review not found');
    if (r.user_id === userId) throw new AppException('CONFLICT', 'Cannot report your own review');
    // Bir foydalanuvchi bir sharhga bir marta (audit_logs orqali dedupe)
    if (await this.prisma.audit_logs.findFirst({ where: { actor_id: userId, action: 'review.report', target_id: id }, select: { id: true } })) return { reported: true, duplicate: true };
    await this.audit.log({ actor_id: userId, club_id: r.club_id, action: 'review.report', target_type: 'review', target_id: id });
    // 3+ shikoyat → moderatsiya navbatiga
    const u = await this.prisma.reviews.update({ where: { id }, data: { reported_count: { increment: 1 }, ...(r.reported_count + 1 >= 3 && r.status === 'VISIBLE' ? { status: 'PENDING_MODERATION' } : {}) } });
    if (u.status !== r.status) await this.prisma.$transaction((tx) => this.recalc(tx, r.club_id, r.branch_id));
    return { reported: true };
  }

  async adminReviews(q: StaffReviewQuery) {
    const where: Prisma.reviewsWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.q ? { text: { contains: q.q, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([this.prisma.reviews.findMany({ where, orderBy: [{ reported_count: 'desc' }, { created_at: 'desc' }], ...pageArgs(q) }), this.prisma.reviews.count({ where })]);
    const clubs = await this.prisma.clubs.findMany({ where: { id: { in: rows.map((r) => r.club_id) } }, select: { id: true, name: true } });
    const c = new Map(clubs.map((x) => [x.id, x.name]));
    return new Paginated((await this.withAuthors(rows)).map((r) => ({ ...r, club_name: c.get(r.club_id) ?? null })), { page: q.page, limit: q.limit, total });
  }

  async moderate(id: string, status: string, note: string | undefined, actor: Actor) {
    const r = await this.prisma.reviews.findUnique({ where: { id } });
    if (!r) throw new AppException('NOT_FOUND', 'Review not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.reviews.update({ where: { id }, data: { status, moderation_note: note, moderated_by: actor.id } });
      await this.recalc(tx, r.club_id, r.branch_id);
      await this.audit.log({ actor_id: actor.id, club_id: r.club_id, action: 'admin.review.moderate', target_type: 'review', target_id: id, old_value: { status: r.status }, new_value: { status, note } }, tx);
    });
    return { id, status };
  }

  // ================= Sevimlilar =================

  async favorites(userId: string) {
    const favs = await this.prisma.favorites.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' } });
    const branches = await this.prisma.branches.findMany({
      where: { id: { in: favs.map((f) => f.branch_id) }, deleted_at: null },
      select: { id: true, name: true, slug: true, address: true, cover_url: true, latitude: true, longitude: true, rating_avg: true, rating_count: true, status: true, club: { select: { id: true, name: true, logo_url: true, status: true } } },
    });
    const byId = new Map(branches.map((b) => [b.id, b]));
    return favs.map((f) => ({ branch_id: f.branch_id, created_at: f.created_at, branch: byId.get(f.branch_id) ?? null })).filter((f) => f.branch);
  }

  async addFavorite(userId: string, branchId: string) {
    const b = await this.prisma.branches.findFirst({ where: { id: branchId, deleted_at: null } });
    if (!b) throw new AppException('NOT_FOUND', 'Branch not found');
    await this.prisma.favorites.upsert({ where: { user_id_branch_id: { user_id: userId, branch_id: branchId } }, update: {}, create: { user_id: userId, branch_id: branchId } });
    return { favorite: true };
  }

  async removeFavorite(userId: string, branchId: string) {
    await this.prisma.favorites.deleteMany({ where: { user_id: userId, branch_id: branchId } });
    return { favorite: false };
  }

  // ================= Support =================

  async createTicket(userId: string, dto: CreateTicketDto) {
    let clubId = dto.club_id ?? null;
    if (dto.booking_id) {
      const b = await this.prisma.bookings.findFirst({ where: { id: dto.booking_id, customer_id: userId } });
      if (!b) throw new AppException('NOT_FOUND', 'Booking not found');
      clubId = b.club_id;
    }
    const id = uuidv7();
    await this.prisma.$transaction([
      this.prisma.support_tickets.create({ data: { id, user_id: userId, club_id: clubId, booking_id: dto.booking_id, type: dto.type, subject: dto.subject, priority: dto.type === 'PAYMENT' ? 'HIGH' : 'NORMAL' } }),
      this.prisma.support_messages.create({ data: { id: uuidv7(), ticket_id: id, sender_id: userId, body: dto.body } }),
    ]);
    return this.ticket(id, userId, []);
  }

  async tickets(userId: string, q: TicketListQuery, grants: Grant[]) {
    const platform = scopeFilter(grants, 'platform.tickets.manage').platform;
    const where: Prisma.support_ticketsWhereInput = {
      ...(q.all === 'true' && platform ? {} : { user_id: userId }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { subject: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.support_tickets.findMany({ where, orderBy: { updated_at: 'desc' }, ...pageArgs(q), include: { _count: { select: { messages: true } } } }),
      this.prisma.support_tickets.count({ where }),
    ]);
    const users = await this.prisma.users.findMany({ where: { id: { in: rows.map((r) => r.user_id) } }, select: { id: true, phone: true, first_name: true, last_name: true } });
    const clubs = await this.prisma.clubs.findMany({ where: { id: { in: rows.map((r) => r.club_id).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const u = new Map(users.map((x) => [x.id, x]));
    const c = new Map(clubs.map((x) => [x.id, x.name]));
    return new Paginated(rows.map((r) => ({ ...r, user: u.get(r.user_id) ?? null, club_name: r.club_id ? c.get(r.club_id) ?? null : null })), { page: q.page, limit: q.limit, total });
  }

  async ticket(id: string, userId: string, grants: Grant[]) {
    const t = await this.prisma.support_tickets.findUnique({ where: { id }, include: { messages: { orderBy: { created_at: 'asc' } } } });
    const platform = scopeFilter(grants, 'platform.tickets.manage').platform;
    // Klub ustidan shikoyat — tegishli klub xodimlari ham ko'radi (mijoz PII'siz)
    const clubStaff = t?.club_id ? can(grants, 'customers.view', { club_id: t.club_id }) : false;
    if (!t || (t.user_id !== userId && !platform && !clubStaff)) throw new AppException('NOT_FOUND', 'Ticket not found');
    const user = platform || t.user_id === userId ? await this.prisma.users.findUnique({ where: { id: t.user_id }, select: { id: true, phone: true, first_name: true, last_name: true } }) : null;
    return { ...t, user };
  }

  async addMessage(id: string, userId: string, body: string, grants: Grant[]) {
    const t = await this.ticket(id, userId, grants);
    const isStaff = t.user_id !== userId;
    if (t.status === 'CLOSED') throw new AppException('CONFLICT', 'Ticket is closed');
    await this.prisma.$transaction([
      this.prisma.support_messages.create({ data: { id: uuidv7(), ticket_id: id, sender_id: userId, body, is_staff: isStaff } }),
      this.prisma.support_tickets.update({ where: { id }, data: { status: isStaff ? (t.status === 'OPEN' ? 'IN_PROGRESS' : t.status) : t.status === 'RESOLVED' ? 'OPEN' : t.status } }),
    ]);
    if (isStaff) await this.notifications.notify([t.user_id], 'TICKET_REPLY', { subject: t.subject }, { ticket_id: id });
    return this.ticket(id, userId, grants);
  }

  async updateTicket(id: string, dto: UpdateTicketDto, actor: Actor) {
    const t = await this.prisma.support_tickets.findUnique({ where: { id } });
    if (!t) throw new AppException('NOT_FOUND', 'Ticket not found');
    const u = await this.prisma.support_tickets.update({ where: { id }, data: dto });
    await this.audit.log({ actor_id: actor.id, club_id: t.club_id, action: 'admin.ticket.update', target_type: 'support_ticket', target_id: id, old_value: { status: t.status }, new_value: dto });
    return u;
  }

  // ================= Bildirishnomalar =================

  async notificationsList(userId: string, q: NotificationQuery) {
    const rows = await this.prisma.notifications.findMany({
      where: { user_id: userId, ...(q.cursor ? { id: { lt: q.cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const more = rows.length > q.limit;
    const data = rows.slice(0, q.limit);
    return new Paginated(data, { limit: q.limit, next_cursor: more ? data[data.length - 1].id : null });
  }

  async unread(userId: string) {
    return { count: await this.prisma.notifications.count({ where: { user_id: userId, read_at: null } }) };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notifications.updateMany({ where: { id, user_id: userId, read_at: null }, data: { read_at: new Date() } });
    return { read: true };
  }

  async markAllRead(userId: string) {
    const r = await this.prisma.notifications.updateMany({ where: { user_id: userId, read_at: null }, data: { read_at: new Date() } });
    return { updated: r.count };
  }

  async registerDeviceToken(userId: string, token: string, platform: string, appVersion?: string) {
    await this.prisma.device_tokens.upsert({
      where: { token },
      update: { user_id: userId, platform, app_version: appVersion, last_seen_at: new Date(), disabled_at: null },
      create: { id: uuidv7(), user_id: userId, token, platform, app_version: appVersion, last_seen_at: new Date() },
    });
    return { registered: true };
  }

  async removeDeviceToken(userId: string, token: string) {
    await this.prisma.device_tokens.deleteMany({ where: { user_id: userId, token } });
    return { removed: true };
  }

  // ================= E'lonlar =================

  async announcements(clubId: string | null) {
    const now = new Date();
    return this.prisma.announcements.findMany({
      where: { club_id: clubId, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  async createAnnouncement(clubId: string | null, dto: AnnouncementDto, actor: Actor) {
    const a = await this.prisma.announcements.create({
      data: { id: uuidv7(), club_id: clubId, title: dto.title, body: dto.body, audience: dto.audience ?? 'ALL', ends_at: dto.ends_at ? new Date(dto.ends_at) : null, created_by: actor.id, starts_at: new Date() },
    });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: clubId ? 'club.announcement' : 'admin.broadcast', target_type: 'announcement', target_id: a.id, new_value: { title: dto.title, audience: dto.audience } });
    if (dto.notify) {
      let userIds: string[];
      if (clubId) {
        const customers = await this.prisma.bookings.findMany({ where: { club_id: clubId, customer_id: { not: null } }, distinct: ['customer_id'], select: { customer_id: true } });
        userIds = customers.map((c) => c.customer_id!);
      } else {
        const type = dto.audience === 'CUSTOMERS' ? { type: 'CUSTOMER' } : dto.audience === 'STAFF' ? { type: { in: ['STAFF', 'PLATFORM'] } } : {};
        userIds = (await this.prisma.users.findMany({ where: { status: 'ACTIVE', deleted_at: null, ...type }, select: { id: true }, take: 50_000 })).map((u) => u.id);
      }
      for (let i = 0; i < userIds.length; i += 1000) await this.notifications.notify(userIds.slice(i, i + 1000), 'ANNOUNCEMENT', { title: dto.title, body: dto.body }, { announcement_id: a.id, club_id: clubId });
      return { ...a, recipients: userIds.length };
    }
    return a;
  }

  async deleteAnnouncement(id: string, clubId: string | null, actor: Actor) {
    await this.prisma.announcements.deleteMany({ where: { id, club_id: clubId } });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'announcement.delete', target_type: 'announcement', target_id: id });
    return { deleted: true };
  }

  // ================= Promo kodlar =================

  async promotions(clubId: string | null, q: PageQuery) {
    const where: Prisma.promotionsWhereInput = { club_id: clubId, deleted_at: null, ...(q.q ? { code: { contains: q.q.toUpperCase() } } : {}) };
    const [rows, total] = await Promise.all([this.prisma.promotions.findMany({ where, orderBy: { created_at: 'desc' }, ...pageArgs(q) }), this.prisma.promotions.count({ where })]);
    return new Paginated(rows, { page: q.page, limit: q.limit, total });
  }

  async createPromotion(clubId: string | null, dto: PromotionDto, actor: Actor) {
    if (dto.type === 'PERCENT' && dto.value > 100) throw new AppException('VALIDATION_ERROR', 'Percent must be 1-100', { field: 'value' });
    if (await this.prisma.promotions.findUnique({ where: { code: dto.code } })) throw new AppException('CONFLICT', 'Promo code already exists');
    const p = await this.prisma.promotions.create({
      data: {
        id: uuidv7(), club_id: clubId, code: dto.code, type: dto.type, value: BigInt(dto.value), max_discount_amount: dto.max_discount_amount ? BigInt(dto.max_discount_amount) : null,
        min_order_amount: dto.min_order_amount ? BigInt(dto.min_order_amount) : null, usage_limit: dto.usage_limit, per_user_limit: dto.per_user_limit,
        starts_at: dto.starts_at ? new Date(dto.starts_at) : null, ends_at: dto.ends_at ? new Date(dto.ends_at) : null,
        applies_to: (dto.applies_to ?? undefined) as Prisma.InputJsonValue | undefined, funded_by: clubId ? 'CLUB' : 'PLATFORM', is_active: dto.is_active ?? true,
      },
    });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'promotion.create', target_type: 'promotion', target_id: p.id, new_value: dto });
    return p;
  }

  async updatePromotion(id: string, dto: UpdatePromotionDto, grants: Grant[], actor: Actor) {
    const p = await this.prisma.promotions.findFirst({ where: { id, deleted_at: null } });
    if (!p) throw new AppException('NOT_FOUND', 'Promotion not found');
    if (p.club_id) assertCan(grants, 'promotions.manage', { club_id: p.club_id });
    else if (!scopeFilter(grants, 'platform.settings.manage').platform) throw new AppException('NOT_FOUND', 'Promotion not found');
    const u = await this.prisma.promotions.update({
      where: { id },
      data: {
        ...(dto.value !== undefined ? { value: BigInt(dto.value) } : {}),
        ...(dto.max_discount_amount !== undefined ? { max_discount_amount: BigInt(dto.max_discount_amount) } : {}),
        ...(dto.min_order_amount !== undefined ? { min_order_amount: BigInt(dto.min_order_amount) } : {}),
        usage_limit: dto.usage_limit, per_user_limit: dto.per_user_limit, is_active: dto.is_active,
        ...(dto.starts_at !== undefined ? { starts_at: new Date(dto.starts_at) } : {}),
        ...(dto.ends_at !== undefined ? { ends_at: new Date(dto.ends_at) } : {}),
        ...(dto.applies_to !== undefined ? { applies_to: dto.applies_to as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.log({ actor_id: actor.id, club_id: p.club_id, action: 'promotion.update', target_type: 'promotion', target_id: id, new_value: dto });
    return u;
  }

  async deletePromotion(id: string, grants: Grant[], actor: Actor) {
    const p = await this.prisma.promotions.findFirst({ where: { id, deleted_at: null } });
    if (!p) throw new AppException('NOT_FOUND', 'Promotion not found');
    if (p.club_id) assertCan(grants, 'promotions.manage', { club_id: p.club_id });
    else if (!scopeFilter(grants, 'platform.settings.manage').platform) throw new AppException('NOT_FOUND', 'Promotion not found');
    await this.prisma.promotions.update({ where: { id }, data: { deleted_at: new Date(), is_active: false } });
    await this.audit.log({ actor_id: actor.id, club_id: p.club_id, action: 'promotion.delete', target_type: 'promotion', target_id: id });
    return { deleted: true };
  }

  async validatePromo(userId: string, code: string, branchId: string, amount: number, startAt?: string, deviceIds: string[] = []) {
    const b = await this.prisma.branches.findFirst({ where: { id: branchId, deleted_at: null } });
    if (!b) throw new AppException('NOT_FOUND', 'Branch not found');
    // Bron yaratishdagi kontekst bilan bir xil: haqiqiy boshlanish vaqti (filial TZ) va qurilma turlari
    const start = startAt ? new Date(startAt) : new Date();
    const devices = deviceIds.length ? await this.prisma.devices.findMany({ where: { id: { in: deviceIds }, branch_id: branchId }, select: { type: true } }) : [];
    const r = await this.pricing.promo(code, {
      club_id: b.club_id, branch_id: branchId, user_id: userId, subtotal: BigInt(amount), device_types: devices.map((d) => d.type), start,
      weekday: DateTime.fromJSDate(start, { zone: b.timezone }).weekday,
    });
    return { valid: true, code: r.code, discount: r.discount, total: BigInt(amount) - r.discount };
  }

  clubWhere(grants: Grant[]) {
    return clubScopeWhere(scopeFilter(grants, 'reviews.view'), grants);
  }
}
