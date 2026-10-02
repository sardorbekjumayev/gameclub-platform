import { Injectable } from '@nestjs/common';
import type { payments } from '@prisma/client';
import { uuidv7 } from '../../../common/utils/id';
import { SettingsService } from '../../settings/settings.service';
import { PaymentProvider } from './provider';

@Injectable()
export class DemoProvider implements PaymentProvider {
  readonly code = 'DEMO' as const;
  readonly name = 'Demo';
  constructor(private readonly settings: SettingsService) {}
  async enabled() {
    return (await this.settings.get<boolean>('payments.demo_enabled')) === true;
  }
  createCheckout(p: payments) {
    return { url: `/pay/demo/${p.id}` };
  }
  async refund() {
    return { status: 'COMPLETED' as const, provider_refund_id: `demo-rf-${uuidv7().slice(-12)}` };
  }
}
