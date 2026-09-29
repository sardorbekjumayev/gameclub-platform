import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsObject, IsOptional, IsString, Length, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** Faqat O'zbekiston raqamlari (SMS-pumping himoyasi: prefiks allowlist). */
export const UZ_PHONE = /^\+998\d{9}$/;

export class SendOtpDto {
  @ApiProperty({ example: '+998901234567' })
  @Matches(UZ_PHONE, { message: 'phone must be in +998XXXXXXXXX format' })
  phone: string;

  @ApiProperty({ enum: ['LOGIN', 'REGISTER', 'RESET'] })
  @IsIn(['LOGIN', 'REGISTER', 'RESET'])
  purpose: 'LOGIN' | 'REGISTER' | 'RESET';
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+998901234567' })
  @Matches(UZ_PHONE)
  phone: string;

  @ApiProperty({ example: '000000' })
  @Matches(/^\d{6}$/)
  code: string;

  @ApiPropertyOptional({ description: 'Qurilma haqida: platform, model, app_version' })
  @IsOptional()
  @IsObject()
  device?: Record<string, unknown>;
}

export class LoginDto {
  @ApiProperty({ description: 'email yoki telefon', example: 'admin@gameclub.local' })
  @IsString()
  @MaxLength(254)
  login: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  device?: Record<string, unknown>;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  refresh_token: string;
}

export class SetPasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) first_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) last_name?: string;
  @ApiPropertyOptional({ enum: ['uz', 'ru', 'en'] }) @IsOptional() @IsIn(['uz', 'ru', 'en']) language?: 'uz' | 'ru' | 'en';
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  email?: string | null;
}
