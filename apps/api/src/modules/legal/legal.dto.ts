import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { LEGAL_DOCS, LEGAL_LANGS, type LegalDoc, type LegalLang } from './defaults';

/** Matn hajmi chegaralari: JSON body umumiy 100 KB limitiga (kirill — 2 bayt/belgi) sig'adi. */
export const LEGAL_TITLE_MAX = 200;
export const LEGAL_BODY_MAX = 40_000;

export class LegalQuery {
  @ApiPropertyOptional({ enum: LEGAL_LANGS, description: "Noma'lum yoki bo'sh til — `uz`" })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  lang?: string;
}

export class UpdateLegalDto {
  @ApiProperty({ enum: LEGAL_LANGS }) @IsIn(LEGAL_LANGS) lang!: LegalLang;
  @ApiProperty({ maxLength: LEGAL_TITLE_MAX }) @IsString() @MinLength(2) @MaxLength(LEGAL_TITLE_MAX) title!: string;
  @ApiProperty({ maxLength: LEGAL_BODY_MAX, description: "Markdown (HTML ko'rsatilmaydi — klient faqat xavfsiz markdown render qiladi)" })
  @IsString()
  @MinLength(20)
  @MaxLength(LEGAL_BODY_MAX)
  body_markdown!: string;
  @ApiPropertyOptional({ description: "Optimistik qulf: berilsa va joriy versiyaga teng bo'lmasa — CONFLICT" })
  @IsOptional()
  @IsInt()
  @Min(1)
  expected_version?: number;
}

export class LegalDocResponse {
  @ApiProperty({ enum: LEGAL_DOCS }) doc!: LegalDoc;
  @ApiProperty({ enum: LEGAL_LANGS }) lang!: LegalLang;
  @ApiProperty() title!: string;
  @ApiProperty() body_markdown!: string;
  @ApiProperty({ description: 'Har tahrirda +1; qoralama — 1' }) version!: number;
  @ApiProperty({ format: 'date-time' }) updated_at!: string;
}
