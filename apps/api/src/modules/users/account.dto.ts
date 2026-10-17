import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({ description: 'Tasdiq — ataylab o\'chirish uchun `true` bo\'lishi shart' })
  @IsBoolean()
  @Equals(true)
  confirm!: boolean;

  @ApiPropertyOptional({ description: 'Ixtiyoriy sabab (audit uchun)', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
