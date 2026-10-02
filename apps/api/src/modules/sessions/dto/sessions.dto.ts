import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class WalkInDto {
  @ApiProperty() @IsUUID() branch_id!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID('all', { each: true }) device_ids!: string[];
  @ApiProperty() @IsInt() @Min(15) @Max(1440) duration_minutes!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) guest_name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+998\d{9}$/) guest_phone?: string;
  @ApiProperty({ enum: ['CASH', 'TERMINAL', 'LATER'] }) @IsIn(['CASH', 'TERMINAL', 'LATER']) payment_method!: 'CASH' | 'TERMINAL' | 'LATER';
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() start_now?: boolean;
}

export class StartSessionDto {
  @ApiProperty() @IsUUID() booking_id!: string;
  @ApiPropertyOptional({ description: 'Ko\'p qurilmali bronda bitta qurilma' }) @IsOptional() @IsUUID() device_id?: string;
}

export class ExtendDto {
  @ApiProperty() @IsInt() @Min(15) @Max(720) minutes!: number;
  @ApiPropertyOptional({ enum: ['CASH', 'TERMINAL', 'LATER'] }) @IsOptional() @IsIn(['CASH', 'TERMINAL', 'LATER']) payment_method?: 'CASH' | 'TERMINAL' | 'LATER';
}

export class MoveDto {
  @ApiProperty() @IsUUID() to_device_id!: string;
}

export class StopDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @ApiPropertyOptional({ description: 'Overtime hisoblamaslik' }) @IsOptional() @IsBoolean() waive_overtime?: boolean;
}

export class ActiveQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branch_id?: string;
}

export class QuickPayDto {
  @ApiPropertyOptional({ enum: ['CASH', 'TERMINAL'] }) @IsOptional() @IsIn(['CASH', 'TERMINAL']) method?: 'CASH' | 'TERMINAL';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) amount?: number;
}
