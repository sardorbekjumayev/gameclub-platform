import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
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

export const TICKET_TYPES = ['SUGGESTION', 'REQUEST', 'COMPLAINT', 'QUESTION', 'BUG', 'PAYMENT', 'OTHER'] as const;
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

export class CreateTicketDto {
  @ApiProperty({ enum: TICKET_TYPES, description: 'SUGGESTION — taklif, REQUEST — talab/so\'rov' }) @IsIn(TICKET_TYPES) type!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) subject!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  @ApiPropertyOptional({ description: 'STAFF — klub/operator panelidan (rol snapshot olinadi); bo\'lmasa mijoz' }) @IsOptional() @IsIn(['CUSTOMER', 'STAFF']) as?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() club_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() booking_id?: string;
}
export class TicketMessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}
export class TicketListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: TICKET_STATUSES }) @IsOptional() @IsIn(TICKET_STATUSES) status?: string;
  @ApiPropertyOptional({ enum: TICKET_TYPES }) @IsOptional() @IsIn(TICKET_TYPES) type?: string;
  @ApiPropertyOptional({ enum: ['CUSTOMER', 'STAFF'], description: 'Yuboruvchi: mijoz yoki klub xodimi (faqat all=true)' }) @IsOptional() @IsIn(['CUSTOMER', 'STAFF']) sender?: string;
  @ApiPropertyOptional({ description: 'Faqat javob kutayotganlar' }) @IsOptional() @IsIn(['true', 'false']) awaiting?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) all?: string;
}
export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES }) @IsOptional() @IsIn(TICKET_STATUSES) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assigned_to?: string;
  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] }) @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: string;
}

export const SOCIAL_KINDS = ['instagram', 'telegram', 'tiktok', 'youtube', 'facebook'] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];
const SOCIAL_URL = /^(https:\/\/\S{3,300})?$/;

/** Platformaning ijtimoiy tarmoqlari; bo'sh qator — o'chirish. */
export class SocialLinksDto {
  @ApiPropertyOptional({ example: 'https://instagram.com/zonup.uz' }) @IsOptional() @IsString() @Matches(SOCIAL_URL) instagram?: string;
  @ApiPropertyOptional({ example: 'https://t.me/zonup_uz' }) @IsOptional() @IsString() @Matches(SOCIAL_URL) telegram?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(SOCIAL_URL) tiktok?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(SOCIAL_URL) youtube?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(SOCIAL_URL) facebook?: string;
}
export class SocialSettingsDto {
  @ApiProperty({ type: SocialLinksDto }) @IsObject() @ValidateNested() @Type(() => SocialLinksDto) links!: SocialLinksDto;
  @ApiProperty({ description: 'Mijozlarga "obuna bo\'ling" taklifini ko\'rsatish (bosh sahifa banneri, chipta sahifasi)' }) @IsBoolean() promo_enabled!: boolean;
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
/** Super admin: promo kodlar ro'yxati — platforma kodlari, klublarniki yoki bitta klubniki. */
export class AdminPromotionQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['PLATFORM', 'CLUBS', 'ALL'], default: 'PLATFORM', description: "PLATFORM — platforma kodlari; CLUBS — klublar qo'shganlari; ALL — hammasi" })
  @IsOptional() @IsIn(['PLATFORM', 'CLUBS', 'ALL']) scope: 'PLATFORM' | 'CLUBS' | 'ALL' = 'PLATFORM';
  @ApiPropertyOptional({ description: 'Faqat shu klub kodlari (scope e\'tiborga olinmaydi)' }) @IsOptional() @IsUUID() club_id?: string;
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
