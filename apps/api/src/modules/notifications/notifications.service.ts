import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { bt, botLang } from '../telegram/bot/bot.i18n';
import { FcmService } from './fcm.service';
import { render } from './templates';

/** Foydalanuvchi sozlamalari (`users.notification_prefs`). Yo'q kalit = default. */
export interface NotificationPrefs {
  telegram: boolean;
  push: boolean;
  reminders: boolean;
  announcements: boolean;
}
export const DEFAULT_PREFS: NotificationPrefs = { telegram: true, push: true, reminders: true, announcements: true };

/** O'chirib bo'lmaydigan (tranzaksion) turlar ham IN_APP ga doim yoziladi; prefs faqat tashqi kanallar va ixtiyoriy turlarga ta'sir qiladi. */
const REMINDER_TYPES = new Set(['BOOKING_REMINDER', 'SESSION_ENDING_SOON', 'REVIEW_REQUEST', 'RENTAL_ENDING_SOON']);
const ANNOUNCEMENT_TYPES = new Set(['ANNOUNCEMENT']);
/** Mijozning o'z broniga oid turlar — Telegram xabariga "Chiptani ko'rish" tugmasi qo'shiladi (xodim turlari emas). */
const CUSTOMER_BOOKING_TYPES = new Set([
  'BOOKING_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'BOOKING_EXPIRED', 'BOOKING_REMINDER', 'NO_SHOW_WARNING',
  'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'TRANSFER_CONFIRMED', 'TRANSFER_REJECTED', 'REFUND_PENDING', 'REFUND_COMPLETED',
  'SESSION_STARTED', 'SESSION_ENDED', 'SESSION_ENDING_SOON',
]);

export interface NotifyOptions {
  /** Takror yuborishdan himoya: (user_id, dedupe_key) unique. */
  dedupe_key?: string;
}

/**
 * Bildirishnomalar (docs/01-API.md §6.15): shablon (i18n) + preferences + kanallar.
 * IN_APP doim; TELEGRAM — telefon bot orqali bog'langan bo'lsa; PUSH (FCM) kalit berilgach adapter sifatida.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly fcm: FcmService,
  ) {}

  static prefs(raw: unknown): NotificationPrefs {
    const o = raw && typeof raw === 'object' ? (raw as Partial<NotificationPrefs>) : {};
    return { ...DEFAULT_PREFS, ...Object.fromEntries(Object.entries(o).filter(([k, v]) => k in DEFAULT_PREFS && typeof v === 'boolean')) };
  }

  async notify(userIds: (string | null | undefined)[], type: string, vars: Record<string, string | number> = {}, data: Record<string, unknown> = {}, opts: NotifyOptions = {}) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    try {
      const users = await this.prisma.users.findMany({ where: { id: { in: ids }, deleted_at: null }, select: { id: true, language: true, phone: true, notification_prefs: true } });
      const phones = users.map((u) => u.phone).filter((p): p is string => !!p);
      const links = phones.length ? await this.prisma.telegram_links.findMany({ where: { phone: { in: phones } }, select: { phone: true, chat_id: true } }) : [];
      const chat = new Map(links.map((l) => [l.phone, l.chat_id]));

      for (const u of users) {
        const prefs = NotificationsService.prefs(u.notification_prefs);
        if (REMINDER_TYPES.has(type) && !prefs.reminders) continue;
        if (ANNOUNCEMENT_TYPES.has(type) && !prefs.announcements) continue;
        const { title, body } = render(type, u.language, vars);
        const chatId = u.phone ? chat.get(u.phone) : undefined;
        const tg = !!chatId && prefs.telegram && this.telegram.enabled;
        const push = prefs.push && this.fcm.enabled;
        const channels = ['IN_APP', ...(tg ? ['TELEGRAM'] : []), ...(push ? ['PUSH'] : [])];
        try {
          await this.prisma.notifications.create({
            data: { id: uuidv7(), user_id: u.id, type, title, body, data: data as Prisma.InputJsonValue, channels, sent_at: new Date(), dedupe_key: opts.dedupe_key ?? null },
          });
        } catch (e) {
          if ((e as { code?: string }).code === 'P2002') continue; // allaqachon yuborilgan
          throw e;
        }
        if (push) {
          this.fcm.sendToUser(u.id, title, body, { type, ...data }).catch((e) => this.log.warn(`push ${type} failed: ${(e as Error).message}`));
        }
        if (tg) {
          const bookingId = CUSTOMER_BOOKING_TYPES.has(type) && typeof data.booking_id === 'string' ? data.booking_id : null;
          const extra = bookingId ? { reply_markup: { inline_keyboard: [[{ text: bt(botLang(u.language), 'notif.open_ticket'), callback_data: `t:${bookingId}:u` }]] } } : {};
          this.telegram
            .sendMessage(chatId!, `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`, extra)
            .catch((e) => this.log.warn(`telegram ${type} failed: ${(e as Error).message}`));
        }
      }
    } catch (e) {
      // Bildirishnoma xatosi asosiy amalni buzmasligi kerak
      this.log.warn(`notify ${type} failed: ${(e as Error).message}`);
    }
  }

  /** Klub xodimlari (shu permission bilan) — masalan NEW_BOOKING. */
  /** Platforma xodimlari (SUPER_ADMIN/SUPPORT) — murojaatlar inbox'i. */
  async notifyPlatformStaff(type: string, vars: Record<string, string | number>, data: Record<string, unknown> = {}, opts: NotifyOptions = {}) {
    const roles = await this.prisma.user_roles.findMany({ where: { role: { code: { in: ['SUPER_ADMIN', 'SUPPORT'] } } }, select: { user_id: true } });
    await this.notify(roles.map((r) => r.user_id), type, vars, data, opts);
  }

  async notifyClubStaff(clubId: string, branchId: string | null, type: string, vars: Record<string, string | number>, data: Record<string, unknown> = {}, opts: NotifyOptions = {}) {
    const roles = await this.prisma.user_roles.findMany({
      where: { OR: [{ club_id: clubId, branch_id: null }, ...(branchId ? [{ branch_id: branchId }] : [])], role: { code: { in: ['CLUB_OWNER', 'CLUB_ADMIN', 'BRANCH_ADMIN'] } } },
      select: { user_id: true },
    });
    await this.notify(roles.map((r) => r.user_id), type, vars, data, opts);
  }

  async getPrefs(userId: string) {
    const u = await this.prisma.users.findUniqueOrThrow({ where: { id: userId }, select: { notification_prefs: true, phone: true } });
    const linked = u.phone ? !!(await this.prisma.telegram_links.findUnique({ where: { phone: u.phone }, select: { id: true } })) : false;
    return { ...NotificationsService.prefs(u.notification_prefs), telegram_linked: linked };
  }

  async updatePrefs(userId: string, patch: Partial<NotificationPrefs>) {
    const u = await this.prisma.users.findUniqueOrThrow({ where: { id: userId }, select: { notification_prefs: true } });
    const next = NotificationsService.prefs({ ...NotificationsService.prefs(u.notification_prefs), ...patch });
    await this.prisma.users.update({ where: { id: userId }, data: { notification_prefs: next as unknown as Prisma.InputJsonValue } });
    return this.getPrefs(userId);
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
