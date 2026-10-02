import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

/**
 * FCM HTTP v1 push. `FCM_SERVICE_ACCOUNT` (JSON yoki base64) bo'lmasa o'chiq.
 * OAuth token service account JWT (RS256) orqali olinadi va ~55 daqiqa keshlanadi.
 * UNREGISTERED/INVALID_ARGUMENT token'lar avtomatik o'chiriladi (disabled_at).
 */
@Injectable()
export class FcmService {
  private readonly log = new Logger('FCM');
  private readonly sa: ServiceAccount | null;
  private token: { value: string; exp: number } | null = null;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.sa = FcmService.parse(config.get<string>('FCM_SERVICE_ACCOUNT'));
  }

  private static parse(raw?: string): ServiceAccount | null {
    if (!raw) return null;
    try {
      const txt = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString();
      const j = JSON.parse(txt) as ServiceAccount;
      return j.project_id && j.client_email && j.private_key ? j : null;
    } catch {
      return null;
    }
  }

  get enabled() {
    return !!this.sa && process.env.NODE_ENV !== 'test';
  }

  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const sa = this.sa!;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error(`oauth failed (${res.status})`);
    this.token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 - 5 * 60_000 };
    return j.access_token;
  }

  /** Foydalanuvchining barcha faol qurilmalariga yuboradi. Xatolar log'ga (token/matn emas). */
  async sendToUser(userId: string, title: string, body: string, data: Record<string, unknown> = {}) {
    if (!this.enabled) return 0;
    const tokens = await this.prisma.device_tokens.findMany({ where: { user_id: userId, disabled_at: null }, select: { id: true, token: true } });
    if (!tokens.length) return 0;
    const access = await this.accessToken();
    const strData = Object.fromEntries(Object.entries(data).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    let sent = 0;
    for (const t of tokens) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.sa!.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: t.token, notification: { title, body }, data: strData } }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (res?.ok) {
        sent++;
        continue;
      }
      const err = res ? ((await res.json().catch(() => null)) as { error?: { status?: string; details?: { errorCode?: string }[] } } | null) : null;
      const code = err?.error?.details?.find((d) => d.errorCode)?.errorCode ?? err?.error?.status;
      if (res?.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') {
        await this.prisma.device_tokens.update({ where: { id: t.id }, data: { disabled_at: new Date() } });
      } else {
        this.log.warn(`push failed: ${res?.status ?? 'network'} ${code ?? ''}`);
      }
    }
    return sent;
  }
}
