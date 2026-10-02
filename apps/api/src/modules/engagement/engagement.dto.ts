import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQuery } from '../../common/dto/pagination.dto';

export class CreateReviewDto {
  @ApiProperty() @IsUUID() booking_id!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) text?: string;
}
export class UpdateReviewDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) text?: string;
}
export class ReplyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) text!: string;
}
export class ReviewListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['recent', 'rating'] }) @IsOptional() @IsIn(['recent', 'rating']) sort?: string;
}
export class StaffReviewQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branch_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['VISIBLE', 'HIDDEN', 'PENDING_MODERATION']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) unanswered?: string;
}
export class ModerateReviewDto {
  @ApiProperty({ enum: ['VISIBLE', 'HIDDEN'] }) @IsIn(['VISIBLE', 'HIDDEN']) status!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CreateTicketDto {
  @ApiProperty({ enum: ['COMPLAINT', 'QUESTION', 'BUG', 'PAYMENT'] }) @IsIn(['COMPLAINT', 'QUESTION', 'BUG', 'PAYMENT']) type!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) subject!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() club_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() booking_id?: string;
}
export class TicketMessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}
export class TicketListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) all?: string;
}
export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] }) @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assigned_to?: string;
  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] }) @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
}

export class NotificationQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class AnnouncementDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(150) title!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(4000) body!: string;
  @ApiPropertyOptional({ enum: ['ALL', 'CUSTOMERS', 'STAFF', 'CLUB_CUSTOMERS'] }) @IsOptional() @IsIn(['ALL', 'CUSTOMERS', 'STAFF', 'CLUB_CUSTOMERS']) audience?: string;
  @ApiPropertyOptional({ description: 'In-app bildirishnoma sifatida yuborish' }) @IsOptional() @IsBoolean() notify?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() ends_at?: string;
}

export class PromotionDto {
  @ApiProperty() @Matches(/^[A-Z0-9_-]{3,32}$/) code!: string;
  @ApiProperty({ enum: ['PERCENT', 'FIXED'] }) @IsIn(['PERCENT', 'FIXED']) type!: string;
  @ApiProperty({ description: 'PERCENT: 1-100; FIXED: tiyin' }) @Type(() => Number) @IsInt() @Min(1) value!: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) max_discount_amount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) min_order_amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usage_limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) per_user_limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() starts_at?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() ends_at?: string;
  @ApiPropertyOptional({ description: '{branch_ids, device_types, weekdays}' }) @IsOptional() @IsObject() applies_to?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}
export class UpdatePromotionDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) value?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) max_discount_amount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) min_order_amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usage_limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) per_user_limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() starts_at?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() ends_at?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() applies_to?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}
export class ValidatePromoDto {
  @ApiProperty() @IsString() @MaxLength(40) code!: string;
  @ApiProperty() @IsUUID() branch_id!: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) amount!: number;
  @ApiPropertyOptional({ description: 'Bron boshlanishi (kun/soat cheklovlari uchun)' }) @IsOptional() @IsDateString() start_at?: string;
  @ApiPropertyOptional({ type: [String], description: 'Tanlangan qurilmalar (tur cheklovi uchun)' }) @IsOptional() @IsArray() @IsUUID('all', { each: true }) device_ids?: string[];
}

export class DeviceTokenDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(4096) token!: string;
  @ApiProperty({ enum: ['ios', 'android', 'web'] }) @IsIn(['ios', 'android', 'web']) platform!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) app_version?: string;
}

export class StringArray {
  @IsArray() @IsString({ each: true }) items!: string[];
}

export class NotificationPrefsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() telegram?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() push?: boolean;
  @ApiPropertyOptional({ description: 'Bron/sessiya eslatmalari' }) @IsOptional() @IsBoolean() reminders?: boolean;
  @ApiPropertyOptional({ description: "Klub e'lonlari" }) @IsOptional() @IsBoolean() announcements?: boolean;
}
