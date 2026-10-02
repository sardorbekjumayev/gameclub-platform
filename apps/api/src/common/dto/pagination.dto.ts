import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class PageQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export const pageArgs = (q: PageQuery) => ({ skip: (q.page - 1) * q.limit, take: q.limit });

export class ReasonDto {
  @IsString() @MaxLength(500) reason!: string;
}

export class OptionalReasonDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
