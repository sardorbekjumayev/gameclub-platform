import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { PageQuery } from '../../common/dto/pagination.dto';

/** Plan limitlari (docs/02-DATABASE.md: branches, devices, operators→staff, analytics, online_booking, api_access, pc_agent). null — cheksiz. */
export class PlanLimitsDto {
  @ApiProperty({ nullable: true }) @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(100000) branches!: number | null;
  @ApiProperty({ nullable: true }) @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(100000) devices!: number | null;
  @ApiProperty({ nullable: true }) @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(100000) staff!: number | null;
  @ApiProperty() @IsBoolean() analytics!: boolean;
  @ApiProperty() @IsBoolean() online_booking!: boolean;
  @ApiProperty() @IsBoolean() api_access!: boolean;
  @ApiProperty() @IsBoolean() pc_agent!: boolean;
}

export class CreatePlanDto {
  @ApiProperty({ example: 'STARTER' }) @Matches(/^[A-Z][A-Z0-9_]{1,29}$/) code!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) name!: string;
  @ApiProperty({ description: 'tiyin/oy' }) @Type(() => Number) @IsInt() @Min(0) price_per_month!: number;
  @ApiProperty({ type: PlanLimitsDto }) @ValidateNested() @Type(() => PlanLimitsDto) limits!: PlanLimitsDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class UpdatePlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @ApiPropertyOptional({ description: 'tiyin/oy' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) price_per_month?: number;
  @ApiPropertyOptional({ type: PlanLimitsDto }) @IsOptional() @ValidateNested() @Type(() => PlanLimitsDto) limits?: PlanLimitsDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class TrialSettingsDto {
  @ApiProperty({ description: 'Yangi klubga beriladigan sinov rejasi' }) @IsUUID() plan_id!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(365) days!: number;
}

export const SUB_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED'] as const;

export class AssignPlanDto {
  @ApiProperty() @IsUUID() plan_id!: string;
  @ApiProperty({ enum: ['TRIALING', 'ACTIVE'] }) @IsIn(['TRIALING', 'ACTIVE']) status!: 'TRIALING' | 'ACTIVE';
  @ApiProperty({ description: 'Davr uzunligi (kun)' }) @IsInt() @Min(1) @Max(3660) days!: number;
}

export class SubscriptionListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: SUB_STATUSES }) @IsOptional() @IsIn(SUB_STATUSES) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() plan_id?: string;
}
