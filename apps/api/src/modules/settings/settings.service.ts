import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';

/** platform_settings default qiymatlari (docs/02-DATABASE.md §3.8). */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'booking.hold_minutes': 10,
  'booking.max_parallel_holds': 2,
  'booking.no_show_limit': 3,
  'booking.no_show_window_days': 30,
  'booking.block_days': 14,
  'commission.default_bps': 500,
  'app.min_version.android': '1.0.0',
  'app.min_version.ios': '1.0.0',
  maintenance_mode: false,
  'payments.demo_enabled': true,
};

@Injectable()
export class SettingsService {
  private cache: { at: number; map: Map<string, unknown> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async all(): Promise<Record<string, unknown>> {
    if (!this.cache || Date.now() - this.cache.at > 30_000) {
      const rows = await this.prisma.platform_settings.findMany();
      this.cache = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r.value])) };
    }
    return { ...DEFAULT_SETTINGS, ...Object.fromEntries(this.cache.map) };
  }

  async get<T>(key: string): Promise<T> {
    return (await this.all())[key] as T;
  }

  async set(key: string, value: unknown, userId: string) {
    await this.prisma.platform_settings.upsert({
      where: { key },
      update: { value: value as Prisma.InputJsonValue, updated_by: userId },
      create: { id: uuidv7(), key, value: value as Prisma.InputJsonValue, updated_by: userId },
    });
    this.cache = null;
  }
}
