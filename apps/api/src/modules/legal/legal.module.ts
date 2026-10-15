import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

/** Huquqiy hujjatlar: oferta, maxfiylik siyosati, foydalanish shartlari, hamkorlik shartlari (`platform_settings` da). */
@Module({ controllers: [LegalController], providers: [LegalService] })
export class LegalModule {}
