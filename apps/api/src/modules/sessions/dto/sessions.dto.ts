import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class WalkInDto {
  @ApiProperty() @IsUUID() branch_id!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID('all', { each: true }) device_ids!: string[];
  @ApiPropertyOptional({ description: 'VIP (ochiq vaqt): tugash vaqtisiz, to\'lov yakunda haqiqiy vaqt bo\'yicha' }) @IsOptional() @IsBoolean() open?: boolean;
  @ApiPropertyOptional({ description: 'Paket (open=true bilan emas); berilsa duration paketnikiga tenglanadi' }) @IsOptional() @IsUUID() package_id?: string;
  @ApiPropertyOptional({ description: 'Majburiy, agar open=true yoki package_id bo\'lmasa' }) @ValidateIf((o: WalkInDto) => !o.open && !o.package_id) @IsInt() @Min(15) @Max(1440) duration_minutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) guest_name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+998\d{9}$/) guest_phone?: string;
  @ApiProperty({ enum: ['CASH', 'TERMINAL', 'LATER'], description: 'open=true da e\'tiborsiz — to\'lov yakunda' }) @IsIn(['CASH', 'TERMINAL', 'LATER']) payment_method!: 'CASH' | 'TERMINAL' | 'LATER';
  @ApiPropertyOptional({ default: true, description: 'open=true da doim darhol boshlanadi' }) @IsOptional() @IsBoolean() start_now?: boolean;
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
  @ApiPropertyOptional({ enum: ['CASH', 'TERMINAL', 'LATER'], description: 'VIP (ochiq vaqt) yakunida to\'lov; LATER — qarz sifatida qoladi' }) @IsOptional() @IsIn(['CASH', 'TERMINAL', 'LATER']) payment_method?: 'CASH' | 'TERMINAL' | 'LATER';
}

export class ActiveQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branch_id?: string;
}

export class QuickPayDto {
  @ApiPropertyOptional({ enum: ['CASH', 'TERMINAL'] }) @IsOptional() @IsIn(['CASH', 'TERMINAL']) method?: 'CASH' | 'TERMINAL';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) amount?: number;
}
