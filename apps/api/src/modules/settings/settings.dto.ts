import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Tahrirlanadigan platforma sozlamalari (oq ro'yxat). Property → `platform_settings` kaliti
 * `SETTINGS_KEY_MAP` da. Ixtiyoriy kalit yozib bo'lmaydi — faqat shu maydonlar.
 */
export class UpdateSettingsDto {
  @ApiPropertyOptional({ description: 'Texnik xizmat rejimi (PLATFORM xodimlaridan boshqa hamma bloklanadi)' })
  @IsOptional()
  @IsBoolean()
  maintenance_mode?: boolean;

  @ApiPropertyOptional({ example: '1.2.0', description: 'Android minimal versiya (semver) — pastroq ilovaga majburiy yangilanish' })
  @IsOptional()
  @IsString()
  @Matches(SEMVER, { message: 'min_version_android must be semver x.y.z' })
  min_version_android?: string;

  @ApiPropertyOptional({ example: '1.2.0', description: 'iOS minimal versiya (semver)' })
  @IsOptional()
  @IsString()
  @Matches(SEMVER, { message: 'min_version_ios must be semver x.y.z' })
  min_version_ios?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, description: 'Standart komissiya (bps, 1% = 100)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  commission_default_bps?: number;

  @ApiPropertyOptional({ description: 'Demo to\'lov yo\'lini yoqish (dev/sinov)' })
  @IsOptional()
  @IsBoolean()
  demo_payments_enabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 120, description: 'Bron hold muddati (daqiqa)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  booking_hold_minutes?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 50, description: 'No-show chegarasi (shundan keyin bron bloklanadi)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  no_show_limit?: number;
}

/** Property → platform_settings kaliti. */
export const SETTINGS_KEY_MAP: Record<keyof UpdateSettingsDto, string> = {
  maintenance_mode: 'maintenance_mode',
  min_version_android: 'app.min_version.android',
  min_version_ios: 'app.min_version.ios',
  commission_default_bps: 'commission.default_bps',
  demo_payments_enabled: 'payments.demo_enabled',
  booking_hold_minutes: 'booking.hold_minutes',
  no_show_limit: 'booking.no_show_limit',
};
