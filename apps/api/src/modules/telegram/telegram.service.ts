import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module';

export type TgUser = { id: number; username?: string; first_name?: string };
export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  contact?: { phone_number: string; user_id?: number; first_name?: string };
};
export type TgUpdate = { update_id: number; message?: TgMessage };
type Handler = (u: TgUpdate) => Promise<void>;

export class TelegramApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const POLL_LOCK = 'tg:poller:lock';
const OFFSET_KEY = 'tg:poller:offset';

/**
 * Telegram Bot API (kutubxonasiz, fetch). Update'lar:
 * - `polling` (dev/bitta instans): getUpdates long-poll, Redis lock bilan faqat bitta instans o'qiydi;
 * - `webhook` (prod): `POST /telegram/webhook` (secret header bilan).
 * Token va xabar matni (OTP kodi) log'ga yozilmaydi.
 */
@Injectable()
export class TelegramService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Telegram');
  private handlers: Handler[] = [];
  private stopped = false;
  private botUsername: string | null = null;
  private readonly instanceId = Math.random().toString(36).slice(2);

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private get token() {
    return this.config.get<string>('TELEGRAM_BOT_TOKEN') || null;
  }

  /** Bot sozlangan va test muhiti emas. */
  get enabled() {
    return !!this.token && this.config.get('NODE_ENV') !== 'test';
  }

  onUpdate(h: Handler) {
    this.handlers.push(h);
  }

  async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    if (!this.token) throw new TelegramApiError(0, 'Telegram bot is not configured');
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 10_000),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; result: T; description?: string; error_code?: number } | null;
    if (!json?.ok) throw new TelegramApiError(json?.error_code ?? res.status, json?.description ?? res.statusText);
    return json.result;
  }

  sendMessage(chatId: number | bigint, text: string, extra: Record<string, unknown> = {}) {
    return this.call('sendMessage', { chat_id: Number(chatId), text, parse_mode: 'HTML', ...extra });
  }

  async username() {
    if (this.botUsername) return this.botUsername;
    this.botUsername = this.config.get<string>('TELEGRAM_BOT_USERNAME')?.replace(/^@/, '') || (await this.call<{ username: string }>('getMe')).username;
    return this.botUsername;
  }

  async deepLink(payload: string) {
    return `https://t.me/${await this.username()}?start=${payload}`;
  }

  async dispatch(u: TgUpdate) {
    for (const h of this.handlers) {
      try {
        await h(u);
      } catch (e) {
        this.logger.warn(`update ${u.update_id} failed: ${(e as Error).message}`);
      }
    }
  }

  async onApplicationBootstrap() {
    if (!this.enabled) {
      this.logger.log('Telegram bot disabled (no TELEGRAM_BOT_TOKEN) — dev OTP code is used');
      return;
    }
    try {
      this.logger.log(`Telegram bot @${await this.username()} (${this.config.get('TELEGRAM_MODE')})`);
    } catch (e) {
      this.logger.error(`Telegram getMe failed: ${(e as Error).message}`);
      return;
    }
    if (this.config.get('TELEGRAM_MODE') === 'webhook') {
      const url = this.config.get<string>('TELEGRAM_WEBHOOK_URL');
      if (url) await this.call('setWebhook', { url, secret_token: this.config.get('TELEGRAM_WEBHOOK_SECRET'), allowed_updates: ['message'] }).catch((e) => this.logger.error(`setWebhook: ${e.message}`));
      return;
    }
    await this.call('deleteWebhook').catch(() => undefined);
    void this.pollLoop();
  }

  onApplicationShutdown() {
    this.stopped = true;
  }

  private async pollLoop() {
    while (!this.stopped) {
      // Faqat bitta instans getUpdates qiladi (aks holda Telegram 409 qaytaradi)
      const owner = await this.redis.set(POLL_LOCK, this.instanceId, 'EX', 60, 'NX').then((r) => r === 'OK' || this.redis.get(POLL_LOCK).then((v) => v === this.instanceId));
      if (!owner) {
        await new Promise((r) => setTimeout(r, 15_000));
        continue;
      }
      await this.redis.expire(POLL_LOCK, 60);
      try {
        const offset = Number((await this.redis.get(OFFSET_KEY)) ?? 0);
        const updates = await this.call<TgUpdate[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        for (const u of updates) {
          await this.redis.set(OFFSET_KEY, String(u.update_id + 1));
          await this.dispatch(u);
        }
      } catch (e) {
        if (!this.stopped) {
          this.logger.warn(`getUpdates: ${(e as Error).message}`);
          await new Promise((r) => setTimeout(r, 5_000));
        }
      }
    }
    await this.redis.get(POLL_LOCK).then((v) => (v === this.instanceId ? this.redis.del(POLL_LOCK) : null));
  }
}
