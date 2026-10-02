import { Global, Module } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { FcmService } from './fcm.service';
import { NotificationsService } from './notifications.service';
import { RemindersService } from './reminders.service';

@Global()
@Module({ providers: [FcmService, NotificationsService, RemindersService, SettingsService], exports: [NotificationsService, RemindersService, SettingsService] })
export class CoreServicesModule {}
