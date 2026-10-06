import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { PageQuery } from '../../../common/dto/pagination.dto';

export const RENTAL_ITEM_TYPES = ['PS5', 'PS4', 'XBOX', 'NINTENDO_SWITCH', 'VR', 'OTHER'] as const;
export const RENTAL_STATUSES = ['REQUESTED', 'CONFIRMED', 'ACTIVE', 'RETURNED', 'CANCELLED', 'REJECTED', 'EXPIRED'] as const;
export const RATE_UNITS = ['HOUR', 'DAY'] as const;
export const FULFILLMENTS = ['PICKUP', 'DELIVERY'] as const;

export class RentalItemDto {
  @ApiProperty({ example: 'PlayStation 5 + 2 joystick' }) @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @ApiProperty({ enum: RENTAL_ITEM_TYPES }) @IsIn(RENTAL_ITEM_TYPES) type!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(500) image_url?: string;
  @ApiPropertyOptional({ type: [String], example: ['2 ta joystick', 'HDMI kabel'] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) includes?: string[];
  @ApiPropertyOptional({ type: [String], example: ['FC 25', 'Mortal Kombat 1'] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(80, { each: true }) games?: string[];
  @ApiPropertyOptional({ description: 'Nechta dona bor', default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(100) quantity?: number;
  @ApiPropertyOptional({ description: 'tiyin/soat; null — soatlik berilmaydi', nullable: true }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) price_per_hour?: number | null;
  @ApiPropertyOptional({ description: 'tiyin/kun; null — kunlik berilmaydi', nullable: true }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) price_per_day?: number | null;
  @ApiPropertyOptional({ description: 'Soatlik arendada minimal soat', default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(72) min_hours?: number;
  @ApiPropertyOptional({ description: 'Maksimal kunlar', default: 30 }) @IsOptional() @IsInt() @Min(1) @Max(90) max_days?: number;
  @ApiPropertyOptional({ description: 'Garov (tiyin, dona uchun)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) deposit_amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() delivery_available?: boolean;
  @ApiPropertyOptional({ description: 'Yetkazib berish narxi (tiyin)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) delivery_fee?: number;
  @ApiPropertyOptional({ example: 'Pasport talab qilinadi' }) @IsOptional() @IsString() @MaxLength(500) requirements?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() position?: number;
}

export class UpdateRentalItemDto extends RentalItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) declare name: string;
  @ApiPropertyOptional({ enum: RENTAL_ITEM_TYPES }) @IsOptional() @IsIn(RENTAL_ITEM_TYPES) declare type: string;
}

export class RentalItemsQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branch_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() club_id?: string;
  @ApiPropertyOptional({ enum: RENTAL_ITEM_TYPES }) @IsOptional() @IsIn(RENTAL_ITEM_TYPES) type?: string;
  @ApiPropertyOptional({ enum: RATE_UNITS, description: 'Faqat shu birlikda beriladiganlar' }) @IsOptional() @IsIn(RATE_UNITS) rate_unit?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) delivery?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class RentalQuoteQuery {
  @ApiProperty({ enum: RATE_UNITS }) @IsIn(RATE_UNITS) rate_unit!: string;
  @ApiProperty({ description: 'Soat yoki kun soni' }) @Type(() => Number) @IsInt() @Min(1) @Max(2160) units!: number;
  @ApiProperty() @IsDateString() start_at!: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) quantity?: number;
  @ApiPropertyOptional({ enum: FULFILLMENTS }) @IsOptional() @IsIn(FULFILLMENTS) fulfillment?: string;
}

export class RentalSlotsQuery {
  @ApiProperty({ example: '2026-10-03' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiProperty({ enum: RATE_UNITS }) @IsIn(RATE_UNITS) rate_unit!: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(2160) units!: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) quantity?: number;
}

export class CreateRentalDto {
  @ApiProperty() @IsUUID() item_id!: string;
  @ApiProperty({ enum: RATE_UNITS }) @IsIn(RATE_UNITS) rate_unit!: string;
  @ApiProperty({ description: 'Soat yoki kun soni' }) @IsInt() @Min(1) @Max(2160) units!: number;
  @ApiProperty({ description: 'Olib ketish (yoki yetkazish) vaqti' }) @IsDateString() start_at!: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(10) quantity?: number;
  @ApiPropertyOptional({ enum: FULFILLMENTS, default: 'PICKUP' }) @IsOptional() @IsIn(FULFILLMENTS) fulfillment?: string;
  @ApiPropertyOptional({ description: 'DELIVERY uchun majburiy' }) @IsOptional() @IsString() @MinLength(5) @MaxLength(300) delivery_address?: string;
  @ApiPropertyOptional({ example: '+998901234567' }) @IsOptional() @Matches(/^\+998\d{9}$/) contact_phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class RentalListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: [...RENTAL_STATUSES, 'OPEN', 'HISTORY', 'OVERDUE'] }) @IsOptional() @IsIn([...RENTAL_STATUSES, 'OPEN', 'HISTORY', 'OVERDUE']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branch_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() club_id?: string;
  @ApiPropertyOptional({ description: 'true — xodim sifatida (klub arendalari)' }) @IsOptional() @IsIn(['true', 'false']) staff?: string;
}

export class RejectRentalDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(300) reason!: string;
}

export class CancelRentalDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export const COLLECT_METHODS = ['CASH', 'TERMINAL', 'CARD_TRANSFER', 'LATER'] as const;

export class HandoverDto {
  @ApiProperty({ enum: COLLECT_METHODS, description: "Arenda haqi qanday olindi (LATER — qaytarishda)" }) @IsIn(COLLECT_METHODS) payment_method!: string;
  @ApiPropertyOptional({ description: 'Garov olindi' }) @IsOptional() @IsBoolean() deposit_collected?: boolean;
}

export class ReturnRentalDto {
  @ApiPropertyOptional({ description: 'Kechikish haqi (tiyin); berilmasa 0' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) late_fee?: number;
  @ApiPropertyOptional({ enum: COLLECT_METHODS, description: 'Qolgan summa qanday olindi' }) @IsOptional() @IsIn(COLLECT_METHODS) payment_method?: string;
  @ApiPropertyOptional({ enum: ['RETURNED', 'KEPT'], description: 'Garov: qaytarildi yoki ushlab qolindi (shikast)' }) @IsOptional() @IsIn(['RETURNED', 'KEPT']) deposit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}
