import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { FILE_PURPOSES } from './files.service';

export class UploadFileDto {
  @ApiProperty({ enum: FILE_PURPOSES, description: "RECEIPT — o'tkazma cheki (mijoz); CLUB_MEDIA — logo/muqova (ommaviy); CLUB_DOCUMENT — klub hujjati" })
  @IsIn(FILE_PURPOSES) purpose!: (typeof FILE_PURPOSES)[number];
  @ApiPropertyOptional({ description: 'CLUB_MEDIA / CLUB_DOCUMENT uchun majburiy' }) @IsOptional() @IsUUID() club_id?: string;
}

export class RawFileQuery {
  @IsOptional() @IsString() exp?: string;
  @IsOptional() @IsString() sig?: string;
}
