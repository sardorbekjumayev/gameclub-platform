import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../../common/dto/pagination.dto';

export const BOOKING_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'CHECKED_IN', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW'] as const;

export class BookingItemDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() device_id?: string;
  @ApiPropertyOptional({ description: 'Kategoriya bo\'yicha — qurilma avtomatik tanlanadi' }) @IsOptional() @IsUUID() category_id?: string;
}

export class CreateBookingDto {
  @ApiProperty() @IsUUID() branch_id!: string;
  @ApiProperty() @IsDateString() start_at!: string;
  @ApiProperty() @IsInt() @Min(15) @Max(1440) duration_minutes!: number;
  @ApiProperty({ type: [BookingItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => BookingItemDto) items!: BookingItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) promo_code?: string;
  @ApiPropertyOptional({ enum: ['APP', 'WEB', 'PHONE'] }) @IsOptional() @IsIn(['APP', 'WEB', 'PHONE']) source?: string;
  @ApiPropertyOptional({ enum: ['ONLINE', 'AT_CLUB'], description: 'AT_CLUB — klubda to\'lash (klub ruxsat bersa)' }) @IsOptional() @IsIn(['ONLINE', 'AT_CLUB']) payment_mode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** Xodim telefon orqali bron qilganda */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) guest_name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+998\d{9}$/) guest_phone?: string;
}

export class BookingListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: BOOKING_STATUSES }) @IsOptional() @IsIn([...BOOKING_STATUSES, 'UPCOMING', 'PAST']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branch_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() club_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ description: 'true — xodim sifatida (klub bronlari)' }) @IsOptional() @IsIn(['true', 'false']) staff?: string;
}

export class CancelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class RescheduleDto {
  @ApiProperty() @IsDateString() start_at!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(15) @Max(1440) duration_minutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() device_id?: string;
}

export class CheckInDto {
  @ApiPropertyOptional({ description: 'Oynadan tashqarida majburiy check-in (operator)' }) @IsOptional() @IsBoolean() force?: boolean;
  @ApiPropertyOptional({ description: 'Darhol sessiyani boshlash' }) @IsOptional() @IsBoolean() start_session?: boolean;
}

export class ScanDto {
  @ApiProperty({ description: 'QR payload yoki bron kodi (GC-XXXXXX)' }) @IsString() @MaxLength(200) qr_payload!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() start_session?: boolean;
}

export class AvailabilityQuery {
  @ApiProperty() @IsDateString() start_at!: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(15) @Max(1440) duration!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() device_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() room_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() category_id?: string;
}

export class SlotsQuery {
  @ApiProperty({ example: '2026-09-30' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(15) @Max(1440) duration!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() device_type?: string;
  @ApiPropertyOptional({ description: "Ko'chirish uchun: shu bronning qurilmalari bo'yicha, o'z band vaqtini hisobga olmasdan (slot mos = free === qurilmalar soni)" })
  @IsOptional() @IsUUID() exclude_booking_id?: string;
}
