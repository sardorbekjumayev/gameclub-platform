import { Injectable } from '@nestjs/common';
import { AppException } from '../../../common/errors';
import { ClickProvider } from './click.provider';
import { DemoProvider } from './demo.provider';
import { PaymeProvider } from './payme.provider';
import { PaymentProvider } from './provider';

@Injectable()
export class PaymentProviders {
  private readonly all: PaymentProvider[];
  constructor(demo: DemoProvider, payme: PaymeProvider, click: ClickProvider) {
    this.all = [payme, click, demo];
  }

  /** Mijozga ko'rsatiladigan yoqilgan provayderlar. */
  async enabled() {
    const out: { code: string; name: string }[] = [];
    for (const p of this.all) if (await p.enabled()) out.push({ code: p.code, name: p.name });
    return out;
  }

  find(code: string | null | undefined) {
    return this.all.find((p) => p.code === code) ?? null;
  }

  async require(code: string) {
    const p = this.find(code);
    if (!p || !(await p.enabled())) throw new AppException('PAYMENT_FAILED', `Payment provider ${code} is not available`);
    return p;
  }
}
