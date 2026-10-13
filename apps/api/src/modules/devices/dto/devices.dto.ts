import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
  MinLength, ValidateNested,
} from 'class-validator';

export const DEVICE_TYPES = ['PC', 'PS5', 'PS4', 'XBOX', 'RACING_SIMULATOR', 'OTHER'] as const;
export const OP_STATUSES = ['ACTIVE', 'MAINTENANCE', 'DISABLED'] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CategoryDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @ApiProperty({ enum: DEVICE_TYPES }) @IsIn(DEVICE_TYPES) device_type!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() position?: number;
}

export class DeviceDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @ApiProperty({ enum: DEVICE_TYPES }) @IsIn(DEVICE_TYPES) type!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() room_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() category_id?: string;
  @ApiPropertyOptional({ description: 'cpu, gpu, ram, monitor, refresh_rate, peripherals' }) @IsOptional() @IsObject() specs?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsInt() position_order?: number;
}

export class UpdateDeviceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @ApiPropertyOptional({ enum: DEVICE_TYPES }) @IsOptional() @IsIn(DEVICE_TYPES) type?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() room_id?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() category_id?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsObject() specs?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsInt() position_order?: number;
}

export class BulkDevicesDto {
  @ApiProperty({ example: 'PC-' }) @IsString() @MinLength(1) @MaxLength(20) prefix!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(999) from!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(999) to!: number;
  @ApiProperty({ enum: DEVICE_TYPES }) @IsIn(DEVICE_TYPES) type!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() room_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() category_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() specs?: Record<string, unknown>;
}

export class DeviceStatusDto {
  @ApiProperty({ enum: OP_STATUSES }) @IsIn(OP_STATUSES) operational_status!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @ApiPropertyOptional({ enum: ['cancel'], description: 'Kelajakdagi bronlarni bekor qilish (refund bilan)' }) @IsOptional() @IsIn(['cancel']) resolve?: string;
}

export class MaintenanceDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
}
export class UpdateMaintenanceDto {
  @ApiProperty({ enum: ['OPEN', 'IN_PROGRESS', 'DONE'] }) @IsIn(['OPEN', 'IN_PROGRESS', 'DONE']) status!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class LayoutItem {
  @IsUUID() device_id!: string;
  @IsInt() @Min(0) @Max(100) x!: number;
  @IsInt() @Min(0) @Max(100) y!: number;
  @ApiPropertyOptional({ nullable: true, description: 'Qurilmani boshqa xonaga ko\'chirish (null — xonasiz)' }) @IsOptional() @IsUUID() room_id?: string | null;
}
export class LayoutDto {
  @ApiProperty({ type: [LayoutItem] }) @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => LayoutItem) items!: LayoutItem[];
}

export class TariffRuleDto {
  @ApiProperty({ example: [1, 2, 3, 4, 5] }) @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days_of_week!: number[];
  @ApiProperty({ example: '22:00' }) @Matches(TIME) start_time!: string;
  @ApiProperty({ example: '08:00' }) @Matches(TIME) end_time!: string;
  @ApiProperty({ description: 'tiyin' }) @Type(() => Number) @IsInt() @Min(0) price_per_hour!: number;
  @ApiProperty({ enum: ['STANDARD', 'WEEKEND', 'NIGHT', 'HOLIDAY'] }) @IsIn(['STANDARD', 'WEEKEND', 'NIGHT', 'HOLIDAY']) kind!: string;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @IsDateString() date?: string;
}

export class TariffPackageDto {
  @ApiPropertyOptional({ description: 'Mavjud paket — yangilanadi; yo\'q — yaratiladi' }) @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ example: '3 soat' }) @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @ApiProperty({ example: 180 }) @Type(() => Number) @IsInt() @Min(30) @Max(1440) duration_minutes!: number;
  @ApiProperty({ description: 'tiyin — butun paket narxi', example: 3_000_000 }) @Type(() => Number) @IsInt() @Min(0) price!: number;
  @ApiPropertyOptional({ example: [5, 6], description: "Bo'sh — har kuni" }) @IsOptional() @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days_of_week?: number[];
  @ApiPropertyOptional({ example: '22:00', description: 'Boshlanish oynasi; end_time bilan birga' }) @IsOptional() @Matches(TIME) start_time?: string | null;
  @ApiPropertyOptional({ example: '08:00' }) @IsOptional() @Matches(TIME) end_time?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class TariffDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @ApiProperty({ description: 'tiyin/soat' }) @Type(() => Number) @IsInt() @Min(0) price_per_hour!: number;
  @ApiPropertyOptional({ enum: DEVICE_TYPES }) @IsOptional() @IsIn(DEVICE_TYPES) device_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() category_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() room_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() device_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(15) min_minutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(15) max_minutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() valid_from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() valid_to?: string;
  @ApiPropertyOptional({ type: [TariffRuleDto] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => TariffRuleDto) rules?: TariffRuleDto[];
  @ApiPropertyOptional({ type: [TariffPackageDto], description: "Paketlar; berilsa ro'yxat to'liq almashtiriladi (yo'qlari o'chiriladi)" })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TariffPackageDto) packages?: TariffPackageDto[];
}

export class UpdateTariffDto extends TariffDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) declare name: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) declare price_per_hour: number;
}

export class PriceQuoteDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) device_ids?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() category_id?: string;
  @ApiProperty() @IsDateString() start_at!: string;
  @ApiProperty() @IsInt() @Min(15) @Max(1440) duration_minutes!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) promo_code?: string;
  @ApiPropertyOptional({ description: 'Paket narxi bo\'yicha (duration paketnikiga tenglanadi)' }) @IsOptional() @IsUUID() package_id?: string;
}

export class RoomTariffDto {
  @ApiProperty({ nullable: true, description: 'Xona tarifi; null — biriktirmani olib tashlash' }) @IsOptional() @IsUUID() tariff_id!: string | null;
}
