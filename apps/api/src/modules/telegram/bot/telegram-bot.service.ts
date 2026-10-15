import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DateTime } from 'luxon';
import QRCode from 'qrcode';
import { AppException } from '../../../common/errors';
import { fmtMoney, fmtWhen } from '../../../common/utils/format';
import { PrismaService } from '../../../database/prisma.service';
import { REDIS } from '../../../infra/redis/redis.module';
import { BookingsService, Caller, LIVE_STATUSES } from '../../bookings/bookings.service';
import { BookingListQuery } from '../../bookings/dto/bookings.dto';
import { EngagementService } from '../../engagement/engagement.service';
import { NotificationPrefs, NotificationsService } from '../../notifications/notifications.service';
import { TelegramService, type TgCallback, type TgUpdate } from '../telegram.service';
import { bt, BotLang, botLang, LANG_NAMES, MenuSection, menuSection } from './bot.i18n';

const RATE_LIMIT = 40; // amal / daqiqa / chat
const HISTORY_PAGE = 6;
const QR_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'ACTIVE', 'PENDING_PAYMENT'];
const TOGGLES = ['telegram', 'reminders', 'announcements'] as const;
const COMMANDS: Record<string, MenuSection> = { tickets: 'tickets', history: 'history', profile: 'profile', notifications: 'notifications', settings: 'settings', help: 'help' };

type Account = { userId: string; lang: BotLang; caller: Caller };
type View = { text: string; keyboard?: Btn[][] };
type Btn = { text: string; callback_data?: string; url?: string };
/** Qayerdan kelgan: `u` — faol chiptalar, raqam — tarix sahifasi. */
type Back = string;

const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Telegram bot — mijoz uchun self-service (chiptalar, QR, bekor qilish, profil, bildirishnomalar, sozlamalar).
 * Chat → akkaunt: `telegram_links.chat_id` (Telegram kontakt orqali tasdiqlangan raqam) → `users.phone`.
 * Biznes logika BookingsService/NotificationsService/EngagementService'da — bot faqat ularni chaqiradi va ko'rsatadi.
 * Caller.grants bo'sh — bot doim mijoz sifatida ishlaydi (faqat o'z bronlari, `loadFor` scope tekshiruvi).
 * /start, kontakt va bog'lanmagan chatlar OtpService'da.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnApplicationBootstrap {
  private readonly log = new Logger('TelegramBot');

  constructor(
    private readonly telegram: TelegramService,
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly notifications: NotificationsService,
    private readonly engagement: EngagementService,
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit() {
    this.telegram.onUpdate((u) => this.onUpdate(u));
    this.telegram.onLinked((chatId) => this.welcome(chatId));
  }

  async onApplicationBootstrap() {
    if (!this.telegram.enabled) return;
    // Buyruqlar ro'yxati (Telegram "Menu" tugmasi) — har til uchun
    for (const lang of ['uz', 'ru', 'en'] as BotLang[]) {
      const commands = (['tickets', 'history', 'profile', 'notifications', 'settings', 'help'] as const).map((c) => ({ command: c, description: bt(lang, `cmd.${c}`) }));
      await this.telegram.call('setMyCommands', { commands, ...(lang === 'uz' ? {} : { language_code: lang }) }).catch((e) => this.log.warn(`setMyCommands ${lang}: ${(e as Error).message}`));
    }
  }

  // ---------- Kirish nuqtalari ----------

  private async onUpdate(u: TgUpdate) {
    if (u.callback_query) return this.onCallback(u.callback_query);
    const m = u.message;
    if (!m || m.chat.type !== 'private' || !m.from || m.contact) return;
    const text = m.text?.trim() ?? '';
    if (!text || text.startsWith('/start')) return; // OtpService
    const acc = await this.account(m.chat.id);
    if (!acc) return; // bog'lanmagan yoki akkaunt yo'q — OtpService javob beradi
    if (!(await this.allow(m.chat.id))) return void (await this.telegram.sendMessage(m.chat.id, bt(acc.lang, 'rate_limited')));
    const cmd = text.startsWith('/') ? text.slice(1).split(/[@\s]/)[0].toLowerCase() : null;
    const section = cmd ? COMMANDS[cmd] : menuSection(text);
    if (!section) return this.welcome(m.chat.id); // /menu va noma'lum matn — asosiy menyu
    await this.send(m.chat.id, await this.section(acc, section));
  }

  private async onCallback(q: TgCallback) {
    const chatId = q.message?.chat.id;
    if (!chatId || q.message?.chat.type !== 'private') return void (await this.telegram.answerCallback(q.id));
    const acc = await this.account(chatId);
    if (!acc) return void (await this.telegram.answerCallback(q.id));
    if (!(await this.allow(chatId))) return void (await this.telegram.answerCallback(q.id, bt(acc.lang, 'rate_limited'), true));
    const [action, arg = '', back = 'u'] = (q.data ?? '').split(':');
    const edit = (v: View) => this.telegram.editMessage(chatId, q.message!.message_id, v.text, { reply_markup: { inline_keyboard: v.keyboard ?? [] } });
    try {
      switch (action) {
        case 'tl':
          await edit(await this.tickets(acc));
          break;
        case 'h':
          await edit(await this.history(acc, Number(arg) || 1));
          break;
        case 't':
          await edit(await this.ticket(acc, arg, back));
          break;
        case 'q':
          await this.sendQr(acc, chatId, arg);
          break;
        case 'c':
          await edit(await this.cancelConfirm(acc, arg, back));
          break;
        case 'cy': {
          const r = await this.bookings.cancel(arg, acc.caller, bt(acc.lang, 'cancel.reason'));
          const head = r.refunded_amount > 0n ? bt(acc.lang, 'cancel.done_refund', { amount: fmtMoney(r.refunded_amount) }) : bt(acc.lang, 'cancel.done');
          const v = await this.ticket(acc, arg, back);
          await edit({ ...v, text: `${head}\n\n${v.text}` });
          return void (await this.telegram.answerCallback(q.id, head));
        }
        case 'p':
          await edit(await this.profile(acc));
          break;
        case 'fv':
          await edit(await this.favorites(acc));
          break;
        case 'n':
          await edit(await this.notificationsView(acc));
          break;
        case 'nr': {
          const r = await this.engagement.markAllRead(acc.userId);
          await edit(await this.notificationsView(acc));
          return void (await this.telegram.answerCallback(q.id, bt(acc.lang, 'notif.marked', { n: r.updated })));
        }
        case 's':
          await edit(await this.settings(acc));
          break;
        case 'sl':
          await edit(this.languages(acc));
          break;
        case 'lg': {
          const lang = botLang(arg);
          await this.prisma.users.update({ where: { id: acc.userId }, data: { language: lang } });
          const next = { ...acc, lang };
          await edit(await this.settings(next));
          await this.telegram.sendMessage(chatId, bt(lang, 'settings.lang_changed'), { reply_markup: this.menuKeyboard(lang) });
          break;
        }
        case 'st': {
          const key = TOGGLES.find((k) => k === arg);
          if (key) {
            const cur = await this.notifications.getPrefs(acc.userId);
            await this.notifications.updatePrefs(acc.userId, { [key]: !cur[key] } as Partial<NotificationPrefs>);
          }
          await edit(await this.settings(acc));
          break;
        }
      }
      await this.telegram.answerCallback(q.id);
    } catch (e) {
      await this.telegram.answerCallback(q.id, this.errorText(acc.lang, e), true);
      if (!(e instanceof AppException)) this.log.warn(`callback ${action} failed: ${(e as Error).message}`);
    }
  }

  /** Raqam bog'langanda yoki /menu — salom + asosiy menyu. */
  async welcome(chatId: number) {
    const link = await this.prisma.telegram_links.findUnique({ where: { chat_id: BigInt(chatId) } });
    if (!link) return;
    const user = await this.prisma.users.findFirst({ where: { phone: link.phone, deleted_at: null }, select: { first_name: true, language: true, status: true } });
    if (!user || user.status !== 'ACTIVE') {
      await this.telegram.sendMessage(chatId, bt(botLang(user?.language), 'no_account', { phone: link.phone }), { reply_markup: { remove_keyboard: true } });
      return;
    }
    const lang = botLang(user.language);
    await this.telegram.sendMessage(chatId, bt(lang, 'welcome', { name: esc(user.first_name || link.first_name || '👋') }), { reply_markup: this.menuKeyboard(lang) });
  }

  // ---------- Yordamchilar ----------

  private async account(chatId: number): Promise<Account | null> {
    const link = await this.prisma.telegram_links.findUnique({ where: { chat_id: BigInt(chatId) }, select: { phone: true } });
    if (!link) return null;
    const user = await this.prisma.users.findFirst({ where: { phone: link.phone, deleted_at: null, status: 'ACTIVE' }, select: { id: true, language: true } });
    if (!user) return null;
    return { userId: user.id, lang: botLang(user.language), caller: { id: user.id, grants: [] } };
  }

  private async allow(chatId: number) {
    const key = `tg:bot:rl:${chatId}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 60);
    return n <= RATE_LIMIT;
  }

  private send(chatId: number, v: View) {
    return this.telegram.sendMessage(chatId, v.text, v.keyboard ? { reply_markup: { inline_keyboard: v.keyboard } } : {});
  }

  private menuKeyboard(lang: BotLang) {
    const b = (s: MenuSection) => ({ text: bt(lang, `menu.${s}`) });
    return {
      keyboard: [[b('tickets'), b('history')], [b('profile'), b('notifications')], [b('settings'), b('help')]],
      resize_keyboard: true,
      is_persistent: true,
      input_field_placeholder: bt(lang, 'menu.placeholder'),
    };
  }

  private errorText(lang: BotLang, e: unknown) {
    if (e instanceof AppException) {
      if (e.code === 'NOT_FOUND') return bt(lang, 'not_found');
      if (e.code === 'BOOKING_NOT_CANCELLABLE') return bt(lang, e.details.reason === 'TRANSFER_PENDING' ? 'cancel.transfer_pending' : 'cancel.not_allowed');
      if (e.code === 'CONFLICT') return bt(lang, 'ticket.qr_unavailable');
    }
    return bt(lang, 'error');
  }

  private section(acc: Account, s: MenuSection): Promise<View> | View {
    switch (s) {
      case 'tickets':
        return this.tickets(acc);
      case 'history':
        return this.history(acc, 1);
      case 'profile':
        return this.profile(acc);
      case 'notifications':
        return this.notificationsView(acc);
      case 'settings':
        return this.settings(acc);
      case 'help':
        return { text: bt(acc.lang, 'help') };
    }
  }

  private when(lang: BotLang, start: Date, end: Date, tz: string, open = false) {
    const fmt = lang === 'en' ? 'cccc, d MMMM' : lang === 'ru' ? 'd MMMM, cccc' : 'd-MMMM, cccc';
    const s = DateTime.fromJSDate(start, { zone: tz }).setLocale(lang);
    // VIP (ochiq vaqt): tugash vaqti operator yopguncha noma'lum
    if (open) return `${s.toFormat(fmt)} · ${s.toFormat('HH:mm')}–… (VIP)`;
    const e = DateTime.fromJSDate(end, { zone: tz }).setLocale(lang);
    const endStr = s.hasSame(e, 'day') ? e.toFormat('HH:mm') : `${e.toFormat(fmt)} ${e.toFormat('HH:mm')}`;
    return `${s.toFormat(fmt)} · ${s.toFormat('HH:mm')}–${endStr}`;
  }

  private short(start: Date, tz: string) {
    return DateTime.fromJSDate(start, { zone: tz }).toFormat('dd.MM HH:mm');
  }

  private duration(lang: BotLang, min: number) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (!h) return bt(lang, 'ticket.minutes', { n: m });
    return m ? bt(lang, 'ticket.hours_minutes', { h, m }) : bt(lang, 'ticket.hours', { h });
  }

  private webUrl(path: string) {
    const base = this.config.get<string>('PUBLIC_WEB_URL');
    // Telegram faqat ochiq https havolani tugmada qabul qiladi
    return base && base.startsWith('https://') ? `${base.replace(/\/$/, '')}${path}` : null;
  }

  // ---------- Bo'limlar ----------

  private async tickets(acc: Account): Promise<View> {
    const page = await this.bookings.list({ status: 'UPCOMING', page: 1, limit: 10 } as BookingListQuery, acc.caller);
    const rows = page.data as Array<{ id: string; code: string; status: string; start_at: Date; branch: { name: string; timezone: string; club: { name: string } } | null }>;
    if (!rows.length) return { text: `${bt(acc.lang, 'tickets.title', { count: 0 })}\n\n${bt(acc.lang, 'tickets.empty')}`, keyboard: [[{ text: bt(acc.lang, 'refresh'), callback_data: 'tl' }]] };
    const lines = rows.map((r) => `• <b>${r.code}</b> — ${esc(r.branch?.club.name)} (${esc(r.branch?.name)})\n   ${this.short(r.start_at, r.branch?.timezone ?? 'Asia/Tashkent')} · ${bt(acc.lang, `status.${r.status}`)}`);
    return {
      text: `${bt(acc.lang, 'tickets.title', { count: rows.length })}\n\n${lines.join('\n')}\n\n${bt(acc.lang, 'tickets.hint')}`,
      keyboard: [
        ...rows.map((r) => [{ text: `🎟 ${r.code} · ${this.short(r.start_at, r.branch?.timezone ?? 'Asia/Tashkent')}`, callback_data: `t:${r.id}:u` }]),
        [{ text: bt(acc.lang, 'refresh'), callback_data: 'tl' }],
      ],
    };
  }

  private async history(acc: Account, pageNo: number): Promise<View> {
    const page = await this.bookings.list({ status: 'PAST', page: pageNo, limit: HISTORY_PAGE } as BookingListQuery, acc.caller);
    const rows = page.data as Array<{ id: string; code: string; status: string; start_at: Date; total_amount: bigint; branch: { name: string; timezone: string; club: { name: string } } | null }>;
    const total = page.meta.total ?? 0;
    if (!total) return { text: bt(acc.lang, 'history.empty') };
    const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE));
    const lines = rows.map((r) => `• <b>${r.code}</b> — ${esc(r.branch?.club.name)}\n   ${this.short(r.start_at, r.branch?.timezone ?? 'Asia/Tashkent')} · ${fmtMoney(r.total_amount)} · ${bt(acc.lang, `status.${r.status}`)}`);
    const nav: Btn[] = [];
    if (pageNo > 1) nav.push({ text: bt(acc.lang, 'prev'), callback_data: `h:${pageNo - 1}` });
    if (pageNo < pages) nav.push({ text: bt(acc.lang, 'next'), callback_data: `h:${pageNo + 1}` });
    return {
      text: `${bt(acc.lang, 'history.title', { page: pageNo, pages })}\n\n${lines.join('\n')}`,
      keyboard: [...rows.map((r) => [{ text: `${r.code} · ${this.short(r.start_at, r.branch?.timezone ?? 'Asia/Tashkent')}`, callback_data: `t:${r.id}:${pageNo}` }]), ...(nav.length ? [nav] : [])],
    };
  }

  private async ticket(acc: Account, id: string, back: Back): Promise<View> {
    const d = await this.bookings.get(id, acc.caller);
    const L = (k: string, v: string) => `<b>${bt(acc.lang, k)}:</b> ${v}`;
    const tz = d.branch?.timezone ?? 'Asia/Tashkent';
    const seats = d.items
      .filter((i) => i.active || !LIVE_STATUSES.includes(d.status))
      .map((i) => (i.device ? `${esc(i.device.name)}${i.device.room?.name ? ` (${esc(i.device.room.name)})` : ''}` : '—'));
    const lines = [
      `🎟 <b>${bt(acc.lang, 'ticket.code')} ${d.code}</b>`,
      '',
      L('ticket.club', `${esc(d.club?.name)} — ${esc(d.branch?.name)}`),
      L('ticket.address', esc(d.branch?.address)),
      L('ticket.devices', [...new Set(seats)].join(', ') || '—'),
      L('ticket.when', this.when(acc.lang, d.start_at, d.end_at, tz, d.is_open && d.status !== 'COMPLETED')),
      L('ticket.duration', this.duration(acc.lang, d.duration_minutes)),
      L('ticket.status', bt(acc.lang, `status.${d.status}`)),
      '',
      L('ticket.total', fmtMoney(d.total_amount)),
      ...(d.discount_amount > 0n ? [L('ticket.discount', `−${fmtMoney(d.discount_amount)}`)] : []),
      L('ticket.payment', `${bt(acc.lang, `pay.${d.payment_status}`)} (${fmtMoney(d.paid_amount)})`),
      ...(d.amount_due > 0n ? [L('ticket.due', `<b>${fmtMoney(d.amount_due)}</b>`)] : []),
      ...(d.refund_amount ? [L('ticket.refunded', fmtMoney(d.refund_amount))] : []),
    ];
    if (d.checkin_window && ['CONFIRMED', 'PENDING_PAYMENT'].includes(d.status)) {
      lines.push('', bt(acc.lang, 'ticket.checkin', { from: this.short(new Date(d.checkin_window.from), tz), to: DateTime.fromISO(d.checkin_window.to, { zone: tz }).toFormat('HH:mm') }));
    }
    const phone = d.branch?.phone || d.club?.phone;
    if (phone) lines.push(L('ticket.club_phone', esc(phone)));
    if (d.transfer) {
      if (d.transfer.pending) lines.push('', bt(acc.lang, 'ticket.transfer_pending'));
      else {
        if (d.transfer.card_number) lines.push('', bt(acc.lang, 'ticket.transfer', { card: esc(d.transfer.card_number.replace(/(\d{4})(?=\d)/g, '$1 ')), holder: esc(d.transfer.card_holder ?? ''), amount: fmtMoney(d.transfer.amount) }));
        else if (d.transfer.link) lines.push('', bt(acc.lang, 'ticket.transfer_link', { amount: fmtMoney(d.transfer.amount) }));
        if (d.transfer.rejected) lines.push(bt(acc.lang, 'ticket.transfer_rejected', { reason: esc(d.transfer.rejected.failed_reason || '—') }));
      }
    }
    if (d.can_cancel && d.refund_preview && d.paid_amount > 0n) lines.push('', bt(acc.lang, 'ticket.refund_now', { percent: d.refund_preview.percent, amount: fmtMoney(d.refund_preview.amount) }));

    const kb: Btn[][] = [];
    const row1: Btn[] = [];
    if (QR_STATUSES.includes(d.status)) row1.push({ text: bt(acc.lang, 'ticket.show_qr'), callback_data: `q:${d.id}` });
    if (d.can_cancel) row1.push({ text: bt(acc.lang, 'ticket.cancel'), callback_data: `c:${d.id}:${back}` });
    if (row1.length) kb.push(row1);
    const row2: Btn[] = [];
    if (d.branch) row2.push({ text: bt(acc.lang, 'ticket.map'), url: `https://yandex.uz/maps/?pt=${d.branch.longitude},${d.branch.latitude}&z=17&l=map` });
    const web = this.webUrl(`/bookings/${d.id}`);
    if (web) row2.push({ text: bt(acc.lang, 'ticket.open_web'), url: web });
    if (row2.length) kb.push(row2);
    // Klubning to'lov havolasi (Click/Payme/QR) — to'langach chek saytda/ilovada yuboriladi
    if (d.transfer && !d.transfer.pending && d.transfer.link) kb.push([{ text: bt(acc.lang, 'ticket.pay_link', { label: d.transfer.link.label ?? '💳' }), url: d.transfer.link.url }]);
    kb.push([
      { text: bt(acc.lang, 'back'), callback_data: back === 'u' ? 'tl' : `h:${back}` },
      { text: bt(acc.lang, 'refresh'), callback_data: `t:${d.id}:${back}` },
    ]);
    return { text: lines.join('\n'), keyboard: kb };
  }

  private async sendQr(acc: Account, chatId: number, id: string) {
    const [qr, d] = await Promise.all([this.bookings.qr(id, acc.caller), this.bookings.get(id, acc.caller)]);
    const png = await QRCode.toBuffer(qr.qr_payload, { width: 600, margin: 2, errorCorrectionLevel: 'M' });
    const caption = bt(acc.lang, 'ticket.qr_caption', {
      code: qr.code,
      club: `${esc(d.club?.name)} — ${esc(d.branch?.name)}`,
      when: this.when(acc.lang, d.start_at, d.end_at, d.branch?.timezone ?? 'Asia/Tashkent', d.is_open && d.status !== 'COMPLETED'),
    });
    await this.telegram.sendPhoto(chatId, png, caption, { protect_content: true });
  }

  private async cancelConfirm(acc: Account, id: string, back: Back): Promise<View> {
    const d = await this.bookings.get(id, acc.caller);
    if (!d.can_cancel) throw new AppException('BOOKING_NOT_CANCELLABLE', 'Not cancellable', { reason: d.transfer?.pending ? 'TRANSFER_PENDING' : undefined });
    const refund = d.paid_amount > 0n && d.refund_preview ? bt(acc.lang, 'cancel.refund', { amount: fmtMoney(d.refund_preview.amount), percent: d.refund_preview.percent }) : bt(acc.lang, 'cancel.refund_none');
    return {
      text: bt(acc.lang, 'cancel.confirm', { code: d.code, refund }),
      keyboard: [[{ text: bt(acc.lang, 'cancel.yes'), callback_data: `cy:${d.id}:${back}` }, { text: bt(acc.lang, 'cancel.no'), callback_data: `t:${d.id}:${back}` }]],
    };
  }

  private async profile(acc: Account): Promise<View> {
    const [u, groups, favCount] = await Promise.all([
      this.prisma.users.findUniqueOrThrow({ where: { id: acc.userId }, select: { first_name: true, last_name: true, phone: true, email: true, language: true, created_at: true, no_show_count: true, booking_blocked_until: true } }),
      this.prisma.bookings.groupBy({ by: ['status'], where: { customer_id: acc.userId }, _count: { _all: true }, _sum: { paid_amount: true } }),
      this.prisma.favorites.count({ where: { user_id: acc.userId } }),
    ]);
    const count = (ss: string[]) => groups.filter((g) => ss.includes(g.status)).reduce((s, g) => s + g._count._all, 0);
    const total = groups.reduce((s, g) => s + g._count._all, 0);
    const spent = groups.reduce((s, g) => s + (g._sum.paid_amount ?? 0n), 0n);
    const unset = bt(acc.lang, 'profile.unset');
    const L = (k: string, v: string) => `<b>${bt(acc.lang, k)}:</b> ${v}`;
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
    const lines = [
      bt(acc.lang, 'profile.title'),
      '',
      L('profile.name', name ? esc(name) : unset),
      L('profile.phone', esc(u.phone)),
      L('profile.email', u.email ? esc(u.email) : unset),
      L('profile.language', LANG_NAMES[botLang(u.language)]),
      L('profile.since', DateTime.fromJSDate(u.created_at, { zone: 'Asia/Tashkent' }).toFormat('dd.MM.yyyy')),
      '',
      L('profile.bookings', bt(acc.lang, 'profile.bookings_value', { total, active: count(LIVE_STATUSES), completed: count(['COMPLETED']) })),
      L('profile.spent', fmtMoney(spent)),
      L('profile.no_show', String(u.no_show_count)),
    ];
    if (u.booking_blocked_until && u.booking_blocked_until > new Date()) lines.push('', bt(acc.lang, 'profile.blocked', { until: fmtWhen(u.booking_blocked_until) }));
    lines.push('', `<i>${bt(acc.lang, 'profile.edit_hint')}</i>`);
    return {
      text: lines.join('\n'),
      keyboard: [[{ text: bt(acc.lang, 'profile.favorites', { count: favCount }), callback_data: 'fv' }], [{ text: bt(acc.lang, 'menu.settings'), callback_data: 's' }, { text: bt(acc.lang, 'refresh'), callback_data: 'p' }]],
    };
  }

  private async favorites(acc: Account): Promise<View> {
    const favs = await this.engagement.favorites(acc.userId);
    const back = [{ text: bt(acc.lang, 'back'), callback_data: 'p' }];
    if (!favs.length) return { text: bt(acc.lang, 'fav.empty'), keyboard: [back] };
    const lines = favs.slice(0, 15).map((f) => {
      const b = f.branch!;
      const rating = b.rating_count ? ` · ⭐ ${Number(b.rating_avg).toFixed(1)} (${b.rating_count})` : '';
      return `• <b>${esc(b.club.name)}</b> — ${esc(b.name)}${rating}\n   📍 ${esc(b.address)}`;
    });
    return {
      text: `${bt(acc.lang, 'fav.title')}\n\n${lines.join('\n')}`,
      keyboard: [...favs.slice(0, 8).map((f) => [{ text: `📍 ${f.branch!.club.name} — ${f.branch!.name}`.slice(0, 60), url: `https://yandex.uz/maps/?pt=${f.branch!.longitude},${f.branch!.latitude}&z=17&l=map` }]), back],
    };
  }

  private async notificationsView(acc: Account): Promise<View> {
    const [rows, unread] = await Promise.all([
      this.prisma.notifications.findMany({ where: { user_id: acc.userId }, orderBy: { id: 'desc' }, take: 8, select: { title: true, body: true, read_at: true, created_at: true } }),
      this.engagement.unread(acc.userId),
    ]);
    if (!rows.length) return { text: bt(acc.lang, 'notif.empty') };
    const lines = rows.map((n) => `${n.read_at ? '▫️' : '🔵'} <b>${esc(n.title)}</b> · <i>${fmtWhen(n.created_at)}</i>\n${esc(n.body)}`);
    const kb: Btn[][] = [];
    if (unread.count) kb.push([{ text: bt(acc.lang, 'notif.read_all'), callback_data: 'nr' }]);
    kb.push([{ text: bt(acc.lang, 'refresh'), callback_data: 'n' }]);
    return { text: `${bt(acc.lang, 'notif.title', { unread: unread.count })}\n\n${lines.join('\n\n')}`, keyboard: kb };
  }

  private async settings(acc: Account): Promise<View> {
    const p = await this.notifications.getPrefs(acc.userId);
    const on = (v: boolean) => bt(acc.lang, v ? 'settings.on' : 'settings.off');
    return {
      text: bt(acc.lang, 'settings.title', { lang: LANG_NAMES[acc.lang], telegram: on(p.telegram), reminders: on(p.reminders), announcements: on(p.announcements) }),
      keyboard: [
        [{ text: bt(acc.lang, 'settings.language'), callback_data: 'sl' }],
        ...TOGGLES.map((k) => [{ text: `${p[k] ? '✅' : '🚫'} ${bt(acc.lang, `settings.toggle.${k}`)}`, callback_data: `st:${k}` }]),
      ],
    };
  }

  private languages(acc: Account): View {
    return {
      text: bt(acc.lang, 'settings.choose_lang'),
      keyboard: [...(Object.keys(LANG_NAMES) as BotLang[]).map((l) => [{ text: `${l === acc.lang ? '• ' : ''}${LANG_NAMES[l]}`, callback_data: `lg:${l}` }]), [{ text: bt(acc.lang, 'back'), callback_data: 's' }]],
    };
  }
}
