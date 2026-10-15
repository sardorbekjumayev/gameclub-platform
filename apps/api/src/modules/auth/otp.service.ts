import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppException } from '../../common/errors';
import { randomDigits, randomToken, safeEqual, sha256 } from '../../common/utils/crypto';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { REDIS } from '../../infra/redis/redis.module';
import { TelegramApiError, TelegramService, type TgMessage, type TgUpdate } from '../telegram/telegram.service';

const TTL_S = 120;
const RESEND_COOLDOWN_S = 60;
const LINK_TTL_S = 600;
const DAILY_LIMIT = 10;
const IP_HOURLY_LIMIT = 10;
const MAX_ATTEMPTS = 5;
const DEV_CODE = '000000';
const UZ_PHONE = /^\+998\d{9}$/;

export type OtpPurpose = 'LOGIN' | 'REGISTER' | 'RESET';

export type SendOtpResult =
  | { channel: 'TELEGRAM' | 'DEV'; delivered: true; expires_in: number; resend_in: number }
  | { channel: 'TELEGRAM'; delivered: false; bot_url: string; link_expires_in: number; resend_in: number };

const mask = (phone: string) => `${phone.slice(0, 6)}***${phone.slice(-2)}`;

/** Telegram kontaktidagi raqam ("998901234567" yoki "+998 90 ...") → +998XXXXXXXXX. */
export const normalizeTgPhone = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  return `+${digits}`;
};

/**
 * Login kodi (OTP) Telegram bot orqali yuboriladi (SMS emas):
 * 1) `send()` — telefon botga bog'langan bo'lsa kod darhol botga keladi;
 *    bog'lanmagan bo'lsa bot havolasi (`t.me/<bot>?start=<nonce>`) qaytariladi.
 * 2) Botda /start → "Raqamni ulashish" tugmasi → Telegram raqamni tasdiqlaydi → bog'lanadi va kod yuboriladi.
 * Dev (token yo'q, NODE_ENV != production): qat'iy kod 000000.
 */
@Injectable()
export class OtpService implements OnModuleInit {
  private readonly logger = new Logger('Otp');

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.telegram.onUpdate((u) => this.onTelegramUpdate(u));
  }

  private get isProd() {
    return this.config.get('NODE_ENV') === 'production';
  }

  private async bump(key: string, ttl: number) {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttl);
    return n;
  }

  async send(phone: string, purpose: OtpPurpose, ip: string | null): Promise<SendOtpResult> {
    if (await this.redis.exists(`otp:cooldown:${phone}`)) {
      throw new AppException('RATE_LIMITED', 'Please wait before requesting a new code', {
        retry_after: await this.redis.ttl(`otp:cooldown:${phone}`),
      });
    }
    if ((await this.bump(`otp:daily:${phone}`, 86_400)) > DAILY_LIMIT) {
      throw new AppException('RATE_LIMITED', 'Daily OTP limit reached');
    }
    if (ip && (await this.bump(`otp:ip:${ip}`, 3_600)) > IP_HOURLY_LIMIT) {
      throw new AppException('RATE_LIMITED', 'Too many requests');
    }

    if (!this.telegram.enabled) {
      if (this.isProd) throw new AppException('INTERNAL_ERROR', 'OTP channel is not configured');
      await this.issue(phone, purpose, ip, null);
      return { channel: 'DEV', delivered: true, expires_in: TTL_S, resend_in: RESEND_COOLDOWN_S };
    }

    const link = await this.prisma.telegram_links.findUnique({ where: { phone } });
    if (link) {
      try {
        await this.issue(phone, purpose, ip, link.chat_id);
        return { channel: 'TELEGRAM', delivered: true, expires_in: TTL_S, resend_in: RESEND_COOLDOWN_S };
      } catch (e) {
        // Foydalanuvchi botni bloklagan/o'chirgan — bog'lanishni bekor qilib, qayta ulashga yo'naltiramiz
        if (!(e instanceof TelegramApiError && [400, 403].includes(e.status))) throw e;
        await this.prisma.telegram_links.delete({ where: { phone } }).catch(() => undefined);
        await this.redis.del(`otp:code:${phone}`, `otp:cooldown:${phone}`);
      }
    }

    const nonce = randomToken(12);
    await this.redis
      .multi()
      .set(`tg:nonce:${nonce}`, JSON.stringify({ phone, purpose, ip }), 'EX', LINK_TTL_S)
      .set(`otp:cooldown:${phone}`, '1', 'EX', 10)
      .exec();
    return { channel: 'TELEGRAM', delivered: false, bot_url: await this.telegram.deepLink(nonce), link_expires_in: LINK_TTL_S, resend_in: 10 };
  }

  /** Kod yaratish, saqlash (hash) va yuborish. chatId null — dev (yuborilmaydi). fromContact — "Raqamni ulashish" klaviaturasini yopish. */
  private async issue(phone: string, purpose: OtpPurpose, ip: string | null, chatId: bigint | number | null, fromContact = false) {
    const code = chatId !== null || this.isProd ? randomDigits(6) : DEV_CODE;
    if (chatId !== null) {
      await this.telegram.sendMessage(
        chatId,
        `🎮 <b>Zonup</b>\n\nKirish kodi: <code>${code}</code>\n\nKod 2 daqiqa amal qiladi. Uni hech kimga bermang — Zonup xodimlari kodni hech qachon so'ramaydi.`,
        fromContact ? { reply_markup: { remove_keyboard: true } } : {},
      );
    }
    await this.redis
      .multi()
      .set(`otp:code:${phone}`, JSON.stringify({ hash: sha256(`${phone}:${code}`), purpose, attempts: 0 }), 'EX', TTL_S)
      .set(`otp:cooldown:${phone}`, '1', 'EX', RESEND_COOLDOWN_S)
      .exec();
    await this.prisma.otp_requests.create({
      data: { id: uuidv7(), phone, purpose, ip, status: 'SENT', expires_at: new Date(Date.now() + TTL_S * 1000) },
    });
  }

  async verify(phone: string, code: string) {
    const key = `otp:code:${phone}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new AppException('OTP_EXPIRED', 'Code expired');
    const entry = JSON.parse(raw) as { hash: string; purpose: OtpPurpose; attempts: number };

    if (entry.attempts >= MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new AppException('OTP_TOO_MANY_ATTEMPTS', 'Too many attempts');
    }
    if (!safeEqual(entry.hash, sha256(`${phone}:${code}`))) {
      entry.attempts += 1;
      await this.redis.set(key, JSON.stringify(entry), 'KEEPTTL');
      throw new AppException('OTP_INVALID', 'Invalid code', { attempts_left: MAX_ATTEMPTS - entry.attempts });
    }
    await this.redis.del(key);
    return entry.purpose;
  }

  // ---------- Telegram bot ----------

  private contactKeyboard() {
    return { keyboard: [[{ text: '📱 Raqamni ulashish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  }

  private async onTelegramUpdate(u: TgUpdate) {
    const m = u.message;
    if (!m || m.chat.type !== 'private' || !m.from) return;
    if (m.contact) return this.onContact(m);
    const text = m.text?.trim() ?? '';
    if (text.startsWith('/start')) return this.onStart(m, text.slice(6).trim());
    // Bog'langan chatdagi boshqa xabarlar — TelegramBotService (menyu, chiptalar)
    const linked = await this.prisma.telegram_links.findUnique({ where: { chat_id: BigInt(m.chat.id) } });
    if (!linked) await this.telegram.sendMessage(m.chat.id, "Kirish kodini olish uchun raqamingizni ulashing 👇", { reply_markup: this.contactKeyboard() });
  }

  private async onStart(m: TgMessage, nonce: string) {
    if (nonce) await this.redis.set(`tg:chat:${m.chat.id}`, nonce, 'EX', LINK_TTL_S);
    const linked = await this.prisma.telegram_links.findUnique({ where: { chat_id: BigInt(m.chat.id) } });
    if (linked && nonce) {
      // Allaqachon bog'langan chat: kutilayotgan so'rov shu raqamniki bo'lsa — kodni darhol yuboramiz
      const pending = await this.redis.get(`tg:nonce:${nonce}`);
      const req = pending ? (JSON.parse(pending) as { phone: string; purpose: OtpPurpose; ip: string | null }) : null;
      if (req && req.phone === linked.phone) {
        await this.redis.del(`tg:nonce:${nonce}`, `tg:chat:${m.chat.id}`);
        await this.issue(req.phone, req.purpose, req.ip, linked.chat_id);
        return;
      }
    }
    if (linked && !nonce) return this.telegram.linked(m.chat.id); // bot menyusi
    await this.telegram.sendMessage(
      m.chat.id,
      "🎮 <b>Zonup</b>\n\nKirish kodini olish uchun telefon raqamingizni tasdiqlang: pastdagi <b>«📱 Raqamni ulashish»</b> tugmasini bosing.",
      { reply_markup: this.contactKeyboard() },
    );
  }

  private async onContact(m: TgMessage) {
    const c = m.contact!;
    // Faqat o'z kontaktini ulashishi mumkin (boshqa odam raqamini yuborib bo'lmaydi)
    if (!c.user_id || c.user_id !== m.from!.id) {
      await this.telegram.sendMessage(m.chat.id, "Iltimos, faqat o'zingizning raqamingizni tugma orqali ulashing.", { reply_markup: this.contactKeyboard() });
      return;
    }
    const phone = normalizeTgPhone(c.phone_number);
    if (!UZ_PHONE.test(phone)) {
      await this.telegram.sendMessage(m.chat.id, "Hozircha faqat O'zbekiston raqamlari (+998) qo'llab-quvvatlanadi.", { reply_markup: { remove_keyboard: true } });
      return;
    }
    const chatId = BigInt(m.chat.id);
    await this.prisma.$transaction(async (tx) => {
      // Bitta chat — bitta raqam: chat boshqa raqamga o'tgan bo'lsa eski bog'lanish o'chiriladi
      await tx.telegram_links.deleteMany({ where: { chat_id: chatId, NOT: { phone } } });
      await tx.telegram_links.upsert({
        where: { phone },
        update: { chat_id: chatId, tg_user_id: BigInt(m.from!.id), username: m.from!.username ?? null, first_name: c.first_name ?? null },
        create: { id: uuidv7(), phone, chat_id: chatId, tg_user_id: BigInt(m.from!.id), username: m.from!.username ?? null, first_name: c.first_name ?? null },
      });
    });
    this.logger.log(`Telegram linked ${mask(phone)}`);

    const nonce = await this.redis.get(`tg:chat:${m.chat.id}`);
    const pending = nonce ? await this.redis.get(`tg:nonce:${nonce}`) : null;
    const req = pending ? (JSON.parse(pending) as { phone: string; purpose: OtpPurpose; ip: string | null }) : null;
    if (req && req.phone !== phone) {
      await this.telegram.sendMessage(m.chat.id, `Raqamingiz bog'landi (${mask(phone)}), lekin saytda boshqa raqam kiritilgan (${mask(req.phone)}). Saytda shu raqamni kiriting.`, { reply_markup: { remove_keyboard: true } });
      return;
    }
    if (req) {
      await this.redis.del(`tg:nonce:${nonce}`, `tg:chat:${m.chat.id}`);
      await this.issue(phone, req.purpose, req.ip, chatId, true);
    } else {
      await this.telegram.sendMessage(m.chat.id, `✅ Raqamingiz bog'landi: ${mask(phone)}.\nEndi saytda yoki ilovada kirishda kod shu yerga keladi.`, { reply_markup: { remove_keyboard: true } });
    }
    await this.telegram.linked(m.chat.id); // akkaunt bo'lsa — bot menyusi
  }
}
