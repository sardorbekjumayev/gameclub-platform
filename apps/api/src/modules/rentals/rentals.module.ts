import { Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { RentalsController } from './rentals.controller';
import { RentalsService } from './rentals.service';

/** Konsol arendasi. Sweeper: muddati o'tgan so'rovlar, tugash eslatmasi va kechikish xabarlari. */
@Module({ controllers: [RentalsController], providers: [RentalsService] })
export class RentalsModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger('RentalSweeper');

  constructor(private readonly rentals: RentalsService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.rentals.sweep().catch((e) => this.log.warn(`sweep failed: ${(e as Error).message}`));
    }, 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
