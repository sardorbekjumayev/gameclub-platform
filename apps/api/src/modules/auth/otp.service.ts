import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppException } from '../../common/errors';
import { randomDigits, safeEqual, sha256 } from '../../common/utils/crypto';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { REDIS } from '../../infra/redis/redis.module';
import { SmsProvider } from '../../infra/sms/sms.provider';

const TTL_S = 120;
const RESEND_COOLDOWN_S = 60;
const DAILY_LIMIT = 10;
const IP_HOURLY_LIMIT = 10;
const MAX_ATTEMPTS = 5;
const DEV_CODE = '000000';

export type OtpPurpose = 'LOGIN' | 'REGISTER' | 'RESET';

@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly sms: SmsProvider,
    private readonly config: ConfigService,
  ) {}

  private get isProd() {
    return this.config.get('NODE_ENV') === 'production';
  }

  private async bump(key: string, ttl: number) {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttl);
    return n;
  }

  async send(phone: string, purpose: OtpPurpose, ip: string | null) {
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

    const code = this.isProd ? randomDigits(6) : DEV_CODE;
    await this.redis
      .multi()
      .set(`otp:code:${phone}`, JSON.stringify({ hash: sha256(`${phone}:${code}`), purpose, attempts: 0 }), 'EX', TTL_S)
      .set(`otp:cooldown:${phone}`, '1', 'EX', RESEND_COOLDOWN_S)
      .exec();
    await this.prisma.otp_requests.create({
      data: { id: uuidv7(), phone, purpose, ip, status: 'SENT', expires_at: new Date(Date.now() + TTL_S * 1000) },
    });
    await this.sms.send(phone, `Game Club: ${code}`);
    return { expires_in: TTL_S, resend_in: RESEND_COOLDOWN_S };
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
}
