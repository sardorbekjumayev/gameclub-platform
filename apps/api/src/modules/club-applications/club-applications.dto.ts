import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQuery } from '../../common/dto/pagination.dto';
import { UZ_PHONE } from '../auth/dto/auth.dto';

export const APPLICATION_STATUSES = ['NEW', 'CONTACTED', 'APPROVED', 'REJECTED'] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Bo'sh qator → yo'q (ixtiyoriy maydonlar). */
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** zonup.uz → "Klub ochish" formasi (akkauntsiz). */
export class CreateClubApplicationDto {
  @ApiProperty({ example: 'Aziz Karimov' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) full_name!: string;
  @ApiProperty({ example: '+998901234567' }) @Matches(UZ_PHONE, { message: 'phone must be in +998XXXXXXXXX format' }) phone!: string;
  @ApiProperty({ example: 'Cyber Arena' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) club_name!: string;
  @ApiProperty({ example: 'Toshkent' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) city!: string;
  @ApiPropertyOptional() @Transform(trimOrNull) @IsOptional() @IsString() @MaxLength(300) address?: string;
  @ApiPropertyOptional({ description: 'Taxminiy PC/konsollar soni' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) devices_count?: number;
  @ApiPropertyOptional({ description: 'Filiallar soni' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) branches_count?: number;
  @ApiPropertyOptional({ example: '@cyberarena' }) @Transform(trimOrNull) @IsOptional() @IsString() @MaxLength(100) telegram?: string;
  @ApiPropertyOptional() @Transform(trimOrNull) @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @ApiPropertyOptional({ enum: ['uz', 'ru', 'en'] }) @IsOptional() @IsIn(['uz', 'ru', 'en']) language?: string;
}

export class ClubApplicationListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: APPLICATION_STATUSES }) @IsOptional() @IsIn(APPLICATION_STATUSES) status?: string;
}

export class UpdateClubApplicationDto {
  @ApiPropertyOptional({ enum: APPLICATION_STATUSES }) @IsOptional() @IsIn(APPLICATION_STATUSES) status?: string;
  @ApiPropertyOptional({ description: 'Super admin izohi (ichki)' }) @IsOptional() @IsString() @MaxLength(2000) admin_note?: string;
}

export class ClubApplicationCreatedResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: APPLICATION_STATUSES }) status!: string;
}
