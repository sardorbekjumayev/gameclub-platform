import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Interaktiv tranzaksiyalar (bron, to'lov, klub yaratish) yuklama ostida 5s standart limitdan oshib ketishi mumkin
    super({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
