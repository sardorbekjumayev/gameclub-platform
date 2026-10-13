import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DeviceInput, PackageInput, PriceError, promoDiscount, quote, quotePackage, TariffInput } from '../../common/domain/price-engine';
import { AppException } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';

export interface PromoResult {
  promotion_id: string;
  code: string;
  discount: bigint;
  funded_by: string;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async tariffs(branchId: string): Promise<TariffInput[]> {
    return this.prisma.tariffs.findMany({
      where: { branch_id: branchId, deleted_at: null, is_active: true },
      include: { rules: true, packages: { where: { deleted_at: null, is_active: true }, orderBy: [{ position: 'asc' }, { duration_minutes: 'asc' }] } },
    });
  }

  /** Filialning faol paketi (faol tarif ichida). Topilmasa PACKAGE_NOT_FOUND. */
  findPackage(tariffs: TariffInput[], packageId: string): PackageInput {
    const p = tariffs.flatMap((t) => t.packages ?? []).find((x) => x.id === packageId);
    if (!p) throw new AppException('VALIDATION_ERROR', 'Package not found', { field: 'package_id', reason: 'PACKAGE_NOT_FOUND' });
    return p;
  }

  /** Bron snapshot'i: klub paketni keyin o'zgartirsa ham bron shu shartlarda qoladi. */
  packageSnapshot(p: PackageInput) {
    return {
      id: p.id, name: p.name, duration_minutes: p.duration_minutes, price: Number(p.price), tariff_id: p.tariff_id,
      days_of_week: p.days_of_week, start_time: p.start_time ?? null, end_time: p.end_time ?? null,
    };
  }

  /** Snapshot'dan paket (ko'chirishda). */
  packageFromSnapshot(snap: Prisma.JsonValue | null): PackageInput | null {
    const p = (snap as { package?: ReturnType<PricingService['packageSnapshot']> } | null)?.package;
    return p ? { ...p, price: BigInt(p.price) } : null;
  }

  /** Paket berilsa paket narxi, aks holda soatlik tarif. */
  quoteDevice(tariffs: TariffInput[], device: DeviceInput, start: Date, end: Date, tz: string, pkg?: PackageInput | null) {
    try {
      return pkg ? quotePackage(tariffs, device, start, pkg, tz) : quote(tariffs, device, start, end, tz);
    } catch (e) {
      if (e instanceof PriceError) {
        if (e.code === 'NO_TARIFF') throw new AppException('DEVICE_NOT_AVAILABLE', 'No tariff configured for device', e.details);
        if (e.code === 'PACKAGE_DEVICE') throw new AppException('VALIDATION_ERROR', 'Package does not apply to this device', { field: 'package_id', reason: 'PACKAGE_DEVICE', ...e.details });
        if (e.code === 'PACKAGE_TIME') throw new AppException('VALIDATION_ERROR', 'Package is not available at this time', { field: 'package_id', reason: 'PACKAGE_TIME', ...e.details });
        throw new AppException(e.code === 'BELOW_MIN' ? 'BOOKING_TOO_EARLY' : 'BOOKING_TOO_LATE', `Duration out of tariff range (${e.code})`, e.details);
      }
      throw e;
    }
  }

  tryQuote(tariffs: TariffInput[], device: DeviceInput, start: Date, end: Date, tz: string, pkg?: PackageInput | null) {
    try {
      return pkg ? quotePackage(tariffs, device, start, pkg, tz) : quote(tariffs, device, start, end, tz);
    } catch {
      return null;
    }
  }

  /** Promo tekshiruvi (docs/01-API.md §6.12). Xato bo'lsa PROMO_INVALID. */
  async promo(code: string, ctx: { club_id: string; branch_id: string; user_id: string | null; subtotal: bigint; device_types: string[]; start: Date; weekday: number }): Promise<PromoResult> {
    const p = await this.prisma.promotions.findFirst({ where: { code: code.trim().toUpperCase(), deleted_at: null, is_active: true } });
    const invalid = (reason: string) => new AppException('PROMO_INVALID', 'Promo code is not valid', { reason });
    if (!p) throw invalid('NOT_FOUND');
    if (p.club_id && p.club_id !== ctx.club_id) throw invalid('OTHER_CLUB');
    const now = new Date();
    if ((p.starts_at && p.starts_at > now) || (p.ends_at && p.ends_at < now)) throw invalid('EXPIRED');
    if (p.usage_limit != null && p.used_count >= p.usage_limit) throw invalid('LIMIT_REACHED');
    if (p.min_order_amount != null && ctx.subtotal < p.min_order_amount) throw invalid('MIN_AMOUNT');
    const applies = (p.applies_to ?? {}) as { branch_ids?: string[]; device_types?: string[]; weekdays?: number[] };
    if (applies.branch_ids?.length && !applies.branch_ids.includes(ctx.branch_id)) throw invalid('BRANCH');
    if (applies.device_types?.length && !ctx.device_types.every((t) => applies.device_types!.includes(t))) throw invalid('DEVICE_TYPE');
    if (applies.weekdays?.length && !applies.weekdays.includes(ctx.weekday)) throw invalid('WEEKDAY');
    if (p.per_user_limit != null && ctx.user_id) {
      const used = await this.prisma.promotion_redemptions.count({ where: { promotion_id: p.id, user_id: ctx.user_id } });
      if (used >= p.per_user_limit) throw invalid('USER_LIMIT');
    }
    return { promotion_id: p.id, code: p.code, discount: promoDiscount(p, ctx.subtotal), funded_by: p.funded_by };
  }
}
