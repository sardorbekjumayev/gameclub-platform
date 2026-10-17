import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SettingsService } from '../../modules/settings/settings.service';
import { ALLOW_DURING_MAINTENANCE } from '../decorators/auth.decorators';
import { AppException } from '../errors';

/** "a.b.c" → [a,b,c]; noto'g'ri format — null (tekshiruv o'tkazib yuboriladi). */
function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** <0 agar a<b, 0 teng, >0 agar a>b. */
function cmpSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Ikki platforma darvozasi (JwtAuthGuard'dan keyin ishlaydi):
 *  1. Majburiy yangilanish — mobil `X-App-Platform` (ios|android) + `X-App-Version` sarlavhalari
 *     `app.min_version.<platform>` dan past bo'lsa → 426 APP_UPDATE_REQUIRED.
 *  2. Texnik xizmat — `maintenance_mode` yoqilganda PLATFORM xodimlaridan va
 *     `@AllowDuringMaintenance()` route'laridan boshqa hammasi → 503 MAINTENANCE_MODE.
 */
@Injectable()
export class PlatformGateGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    // 1) Mobil minimal versiya
    const platform = String(req.headers['x-app-platform'] ?? '').toLowerCase();
    const rawVersion = String(req.headers['x-app-version'] ?? '');
    if (platform === 'ios' || platform === 'android') {
      const current = parseSemver(rawVersion);
      const min = parseSemver(await this.settings.get<string>(`app.min_version.${platform}`));
      if (current && min && cmpSemver(current, min) < 0) {
        throw new AppException('APP_UPDATE_REQUIRED', 'Please update the app to continue', { platform, min_version: min.join('.'), current: current.join('.') });
      }
    }

    // 2) Texnik xizmat rejimi
    const allow = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_MAINTENANCE, [ctx.getHandler(), ctx.getClass()]);
    if (allow) return true;
    const on = await this.settings.get<boolean>('maintenance_mode');
    if (!on) return true;
    if (req.user?.type === 'PLATFORM') return true; // platforma xodimi — rejimni boshqarishi uchun
    throw new AppException('MAINTENANCE_MODE', 'Platform is temporarily under maintenance');
  }
}
