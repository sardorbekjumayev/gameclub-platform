import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators';
import { AppException } from '../../common/errors';
import { safeEqual } from '../../common/utils/crypto';
import { TelegramService, type TgUpdate } from './telegram.service';

/** Prod: Telegram webhook (TELEGRAM_MODE=webhook). Secret header bilan himoyalangan. */
@ApiExcludeController()
@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() update: TgUpdate, @Headers('x-telegram-bot-api-secret-token') secret?: string) {
    const expected = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (this.config.get('TELEGRAM_MODE') !== 'webhook' || !expected || !secret || !safeEqual(secret, expected)) throw new AppException('FORBIDDEN', 'Invalid webhook');
    await this.telegram.dispatch(update);
    return { ok: true };
  }
}
