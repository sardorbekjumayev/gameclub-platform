import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsObject, IsOptional, IsString, IsUrl, IsUUID,
  Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../../common/dto/pagination.dto';

export const CLUB_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'CLOSED'] as const;
const PHONE = /^\+998\d{9}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateClubDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) telegram?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) instagram?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() website?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() logo_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() cover_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) rules?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) amenities?: string[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(1440) min_booking_minutes?: number;
  /** Egasi hali parol o'rnatmagan bo'lsa (admin panelga kirish uchun) majburiy. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(8) @MaxLength(128) owner_password?: string;
}

export class UpdateClubDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) telegram?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) instagram?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() website?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() logo_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() cover_url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) rules?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) amenities?: string[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(1440) min_booking_minutes?: number;
}

export class AdminCreateClubDto extends CreateClubDto {
  @ApiProperty() @Matches(PHONE) owner_phone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) owner_first_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) owner_last_name?: string;
  @ApiPropertyOptional({ description: 'Default true — klub moderatsiyasiz darhol ACTIVE; false — DRAFT', default: true }) @IsOptional() @IsBoolean() activate?: boolean;
}

export class ClubListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: CLUB_STATUSES }) @IsOptional() @IsIn(CLUB_STATUSES) status?: string;
}

class CancellationRuleDto {
  @IsInt() @Min(0) @Max(100000) min_minutes_before_start!: number;
  @IsInt() @Min(0) @Max(100) refund_percent!: number;
}
class CancellationPolicyDto {
  @IsInt() @Min(0) free_cancel_minutes_before!: number;
  @ValidateNested({ each: true }) @Type(() => CancellationRuleDto) @IsArray() rules!: CancellationRuleDto[];
  @IsBoolean() platform_fee_refundable!: boolean;
  @IsInt() @Min(0) @Max(100) no_show_refund_percent!: number;
}
export class TransferCardDto {
  @ApiProperty({ example: '8600123412341234', description: '16 raqam (bo\'shliqlarsiz)' }) @Matches(/^\d{16}$/) number!: string;
  @ApiProperty({ example: 'ALISHER KARIMOV' }) @IsString() @MinLength(2) @MaxLength(80) holder!: string;
}
export class ClubSettingsDto {
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => CancellationPolicyDto) cancellation_policy?: CancellationPolicyDto;
  @ApiPropertyOptional({ type: TransferCardDto, nullable: true, description: 'null — kartani o\'chirish (mijozlar kartaga o\'tkaza olmaydi)' })
  @IsOptional() @ValidateNested() @Type(() => TransferCardDto) transfer_card?: TransferCardDto | null;
  @ApiPropertyOptional() @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

export class ClubDocumentDto {
  @ApiProperty({ enum: ['LICENSE', 'TAX_ID', 'PASSPORT', 'OTHER'] }) @IsIn(['LICENSE', 'TAX_ID', 'PASSPORT', 'OTHER']) type!: string;
  @ApiProperty() @IsUrl() file_url!: string;
}

export class ReviewDocumentDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] }) @IsIn(['APPROVED', 'REJECTED']) status!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

// ---- Branch ----
export class BookingSettingsDto {
  @IsOptional() @IsIn([15, 30, 60]) slot_minutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) buffer_minutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1440) min_advance_minutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) max_advance_days?: number;
  @IsOptional() @IsInt() @Min(2) @Max(60) hold_minutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) early_checkin_minutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) grace_minutes?: number;
  @IsOptional() @IsBoolean() allow_category_booking?: boolean;
  @IsOptional() @IsBoolean() allow_specific_device?: boolean;
  @IsOptional() @IsBoolean() auto_no_show?: boolean;
  @ApiPropertyOptional({ description: 'VIP (ochiq vaqt): minimal to\'lanadigan daqiqa' }) @IsOptional() @IsInt() @Min(0) @Max(240) open_min_minutes?: number;
  @ApiPropertyOptional({ enum: [1, 5, 10, 15, 30], description: 'VIP (ochiq vaqt): yaxlitlash qadami' }) @IsOptional() @IsIn([1, 5, 10, 15, 30]) open_round_minutes?: number;
}

export class CreateBranchDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) address!: string;
  @ApiProperty() @IsLatitude() latitude!: number;
  @ApiProperty() @IsLongitude() longitude!: number;
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() cover_url?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsUrl({}, { each: true }) images?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) amenities?: string[];
  @ApiPropertyOptional({ description: 'docs/02-DATABASE.md §5 working_hours' }) @IsOptional() @IsObject() working_hours?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => BookingSettingsDto) booking_settings?: BookingSettingsDto;
}

export class UpdateBranchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(300) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(PHONE) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() cover_url?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsUrl({}, { each: true }) images?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) amenities?: string[];
  @ApiPropertyOptional() @IsOptional() @IsObject() working_hours?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => BookingSettingsDto) booking_settings?: BookingSettingsDto;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'TEMPORARILY_CLOSED'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'TEMPORARILY_CLOSED']) status?: string;
}

export class HoursExceptionDto {
  @ApiProperty({ example: '2026-12-31' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiProperty() @IsBoolean() is_closed!: boolean;
  @ApiPropertyOptional() @IsOptional() @Matches(TIME) open_time?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(TIME) close_time?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

// ---- Room ----
export const DECOR_KINDS = ['ENTRANCE', 'CASHIER', 'WALL', 'AISLE', 'TV', 'WC'] as const;
export class RoomDecorDto {
  @ApiProperty({ enum: DECOR_KINDS }) @IsIn(DECOR_KINDS) kind!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(39) x!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(39) y!: number;
}
export const ROOM_TYPES = ['STANDARD', 'VIP', 'BOOTCAMP', 'CONSOLE', 'STREAM'] as const;
export class CreateRoomDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @ApiPropertyOptional({ enum: ROOM_TYPES }) @IsOptional() @IsIn(ROOM_TYPES) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(500) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() position?: number;
  @ApiPropertyOptional({ description: 'Sxema eni (katak)' }) @IsOptional() @IsInt() @Min(2) @Max(40) grid_cols?: number;
  @ApiPropertyOptional({ description: 'Sxema bo\'yi (katak)' }) @IsOptional() @IsInt() @Min(2) @Max(40) grid_rows?: number;
  @ApiPropertyOptional({ type: [RoomDecorDto], description: 'Sxema bezaklari (kirish, kassa, devor...)' }) @IsOptional() @IsArray() @ArrayMaxSize(400) @ValidateNested({ each: true }) @Type(() => RoomDecorDto) decor?: RoomDecorDto[];
}
export class UpdateRoomDto extends CreateRoomDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) declare name: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}

// ---- Staff ----
export const STAFF_ROLES = ['CLUB_ADMIN', 'BRANCH_ADMIN', 'OPERATOR'] as const;
export class AddStaffDto {
  @ApiProperty() @Matches(PHONE) phone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) first_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) last_name?: string;
  @ApiProperty({ enum: STAFF_ROLES }) @IsIn(STAFF_ROLES) role!: string;
  @ApiPropertyOptional({ description: 'BRANCH_ADMIN/OPERATOR uchun majburiy' }) @IsOptional() @IsUUID() branch_id?: string;
  @ApiPropertyOptional({ description: 'Yangi xodim uchun boshlang\'ich parol (admin panelga kirish)' }) @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;
}
export class UpdateStaffDto {
  @ApiProperty({ enum: STAFF_ROLES }) @IsIn(STAFF_ROLES) role!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branch_id?: string;
}

export class InviteStaffDto {
  @ApiProperty() @Matches(PHONE) phone!: string;
  @ApiProperty({ enum: STAFF_ROLES }) @IsIn(STAFF_ROLES) role!: string;
  @ApiPropertyOptional({ description: 'BRANCH_ADMIN/OPERATOR uchun majburiy' }) @IsOptional() @IsUUID() branch_id?: string;
}
export class InvitationTokenDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(200) token!: string;
}
export class AcceptInvitationDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(200) token!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) first_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) last_name?: string;
}

export class CustomerNoteDto {
  @ApiProperty() @IsString() @MaxLength(2000) note!: string;
}
