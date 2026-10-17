import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';

/** SettingsService global (CoreServicesModule); bu modul faqat admin controllerni qo'shadi. */
@Module({ controllers: [SettingsController] })
export class SettingsModule {}
