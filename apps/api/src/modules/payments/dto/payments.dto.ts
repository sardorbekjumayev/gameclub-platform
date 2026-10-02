import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../../../common/dto/pagination.dto';

export class CreatePaymentDto {
  @ApiProperty() @IsUUID() booking_id!: string;
  @ApiProperty({ enum: ['DEMO', 'PAYME', 'CLICK'], description: 'Yoqilganlari: GET /payments/providers' }) @IsIn(['DEMO', 'PAYME', 'CLICK']) provider!: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_tld: false, protocols: ['http', 'https', 'gameclub'], require_valid_protocol: true }) return_url?: string;
}

export class DemoConfirmDto {
  @ApiProperty() @IsBoolean() success!: boolean;
}

export class CashPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() booking_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() session_id?: string;
  @ApiProperty({ enum: ['CASH', 'TERMINAL'] }) @IsIn(['CASH', 'TERMINAL']) method!: 'CASH' | 'TERMINAL';
  @ApiPropertyOptional({ description: 'tiyin; berilmasa qolgan qarz to\'lanadi' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) amount?: number;
}

export class RefundDto {
  @ApiPropertyOptional({ description: 'tiyin; berilmasa to\'liq' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) amount?: number;
  @ApiProperty() @IsString() @MaxLength(500) reason!: string;
}

export class PaymentListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() club_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branch_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() method?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;
}

export class OpenShiftDto {
  @ApiProperty() @IsUUID() branch_id!: string;
  @ApiProperty({ description: 'tiyin' }) @Type(() => Number) @IsInt() @Min(0) opening_cash!: number;
}

export class CloseShiftDto {
  @ApiProperty({ description: 'tiyin' }) @Type(() => Number) @IsInt() @Min(0) counted_cash!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ShiftListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branch_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['OPEN', 'CLOSED']) status?: string;
}
