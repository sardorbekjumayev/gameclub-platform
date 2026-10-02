import { Global, Module, OnApplicationBootstrap, OnApplicationShutdown, Logger } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { PricingService } from './pricing.service';

/**
 * Hold expiry / no-show sweeper (§10). BullMQ queue'lari qo'shilguncha jarayon ichida interval
 * (bir nechta replika bo'lsa ham idempotent — status tekshiruvi tranzaksiyada).
 */
@Global()
@Module({ controllers: [BookingsController], providers: [BookingsService, PricingService], exports: [BookingsService, PricingService] })
export class BookingsModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger('BookingSweeper');

  constructor(private readonly bookings: BookingsService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.bookings.sweep().catch((e) => this.log.warn(`sweep failed: ${(e as Error).message}`));
    }, 15_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
