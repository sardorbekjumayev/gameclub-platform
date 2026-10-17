import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AppException } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import { REDIS } from '../../infra/redis/redis.module';
import { AuditService } from '../audit/audit.service';
import { accessCutoffKey } from '../auth/password';
import { ACCESS_TTL_S } from '../auth/token.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { Actor } from '../clubs/clubs.service';

/**
 * Maxfiylik: akkauntni o'chirish (anonimlashtirish) va shaxsiy ma'lumotlarni eksport qilish.
 * Moliyaviy yozuvlar (to'lov, ledger, bron summalar) saqlanadi — faqat shaxsiy maydonlar tozalanadi (docs/02-DATABASE.md §7).
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** O'zining barcha shaxsiy ma'lumotlari (GDPR eksport). Summalar tiyinda. */
  async exportMe(userId: string) {
    const [user, consents, bookings, payments, rentals, reviews, favorites, tickets, devices] = await Promise.all([
      this.prisma.users.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true, type: true, phone: true, email: true, first_name: true, last_name: true,
          language: true, status: true, notification_prefs: true, created_at: true, last_login_at: true,
        },
      }),
      this.prisma.consents.findMany({ where: { user_id: userId }, select: { document_type: true, version: true, accepted_at: true, ip: true } }),
      this.prisma.bookings.findMany({
        where: { customer_id: userId },
        orderBy: { created_at: 'desc' },
        select: { id: true, code: true, status: true, start_at: true, end_at: true, total_amount: true, paid_amount: true, payment_status: true, created_at: true },
      }),
      this.prisma.payments.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        select: { id: true, amount: true, currency: true, method: true, status: true, paid_at: true, created_at: true },
      }),
      this.prisma.rentals.findMany({
        where: { customer_id: userId },
        orderBy: { created_at: 'desc' },
        select: { id: true, code: true, status: true, start_at: true, end_at: true, total_amount: true, payment_status: true, created_at: true },
      }),
      this.prisma.reviews.findMany({ where: { user_id: userId }, select: { id: true, club_id: true, branch_id: true, rating: true, text: true, created_at: true } }),
      this.prisma.favorites.findMany({ where: { user_id: userId }, select: { branch_id: true, created_at: true } }),
      this.prisma.support_tickets.findMany({ where: { user_id: userId }, select: { id: true, type: true, subject: true, status: true, created_at: true } }),
      this.prisma.device_tokens.findMany({ where: { user_id: userId }, select: { platform: true, app_version: true, last_seen_at: true, disabled_at: true } }),
    ]);
    return { exported_at: new Date(), user, consents, bookings, payments, rentals, reviews, favorites, support_tickets: tickets, device_tokens: devices };
  }

  /**
   * Akkauntni o'chirish: shaxsiy maydonlarni anonimlashtirish, status=DELETED, barcha sessiyalarni bekor qilish.
   * Telefon/email bo'shaydi (null) — keyinroq qayta ro'yxatdan o'tish mumkin. Faqat CUSTOMER o'zini o'chira oladi.
   */
  async deleteMe(userId: string, actor: Actor, reason?: string) {
    const user = await this.prisma.users.findUniqueOrThrow({ where: { id: userId }, select: { type: true, deleted_at: true } });
    if (user.deleted_at) throw new AppException('CONFLICT', 'Account already deleted', { reason: 'ALREADY_DELETED' });
    if (user.type !== 'CUSTOMER') {
      throw new AppException('FORBIDDEN', 'Only customer accounts can be self-deleted; contact platform support', { reason: 'STAFF_ACCOUNT' });
    }
    const liveSession = await this.prisma.sessions.findFirst({ where: { customer_id: userId, status: { in: ['WAITING', 'ACTIVE', 'PAUSED'] } }, select: { id: true } });
    if (liveSession) throw new AppException('CONFLICT', 'Finish your active session before deleting the account', { reason: 'ACTIVE_SESSION' });
    const openRental = await this.prisma.rentals.findFirst({ where: { customer_id: userId, status: { in: ['CONFIRMED', 'ACTIVE'] } }, select: { id: true } });
    if (openRental) throw new AppException('CONFLICT', 'Return the rented console before deleting the account', { reason: 'OPEN_RENTAL' });

    const revoked = await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { id: userId },
        data: {
          // Telefon bo'shaydi (qayta ro'yxatdan o'tish uchun); email — sintetik shaxssiz qiymat
          // (users_login_chk: phone yoki email NOT NULL bo'lishi shart).
          phone: null, email: `deleted-${userId}@deleted.invalid`, first_name: null, last_name: null, avatar_file_id: null,
          password_hash: null, totp_secret_enc: null, totp_enabled: false, must_change_password: false,
          notification_prefs: {}, status: 'DELETED', deleted_at: new Date(),
        },
      });
      const r = await tx.refresh_tokens.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } });
      await tx.device_tokens.updateMany({ where: { user_id: userId, disabled_at: null }, data: { disabled_at: new Date() } });
      await tx.favorites.deleteMany({ where: { user_id: userId } });
      await this.audit.log(
        {
          actor_id: userId, action: 'account.deleted', target_type: 'user', target_id: userId,
          new_value: { reason: reason ?? null, sessions_revoked: r.count },
          ip: actor.ip ?? null, user_agent: actor.ua ?? null, request_id: actor.request_id ?? null,
        },
        tx,
      );
      return r.count;
    });
    // Hali amal qilayotgan access token'lar (15 daq) ham rad etiladi; ochiq socketlar uziladi
    await this.redis.set(accessCutoffKey(userId), String(Math.floor(Date.now() / 1000)), 'EX', ACCESS_TTL_S + 60);
    this.realtime.disconnectUser(userId);
    return { deleted: true, sessions_revoked: revoked };
  }
}
