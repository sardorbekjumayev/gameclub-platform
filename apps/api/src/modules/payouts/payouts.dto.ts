import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQuery } from '../../common/dto/pagination.dto';

export class CalculatePayoutsDto {
  @ApiProperty({ description: 'Davr boshi (UTC ISO, kiritiladi)' }) @IsDateString() period_start!: string;
  @ApiProperty({ description: 'Davr oxiri (UTC ISO, kiritilmaydi)' }) @IsDateString() period_end!: string;
  @ApiPropertyOptional({ description: "Bo'lmasa — shu davrda online tushumi bor barcha klublar" }) @IsOptional() @IsUUID() club_id?: string;
}

export class MarkPaidDto {
  @ApiProperty({ description: "Bank to'lov topshiriqnomasi raqami" }) @IsString() @MaxLength(120) reference!: string;
}

export class PayoutListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() club_id?: string;
  @ApiPropertyOptional({ enum: ['PENDING', 'PAID', 'CANCELLED'] }) @IsOptional() @IsIn(['PENDING', 'PAID', 'CANCELLED']) status?: string;
}
