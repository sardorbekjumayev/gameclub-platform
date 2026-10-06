import { Module } from '@nestjs/common';
import { EngagementModule } from '../../engagement/engagement.module';
import { TelegramBotService } from './telegram-bot.service';

/** Mijoz self-service boti (chiptalar, profil, sozlamalar). Bookings/Notifications global modullardan. */
@Module({ imports: [EngagementModule], providers: [TelegramBotService] })
export class TelegramBotModule {}
