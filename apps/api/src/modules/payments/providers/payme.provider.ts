import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { payments } from '@prisma/client';
import { PaymentProvider } from './provider';

/**
 * Payme (Paycom) merchant API. Checkout: GET-parametrlar base64 da, summa tiyinda.
 * Merchant tomonidan qaytarish API'si yo'q — refund Payme kabinetida bekor qilinadi,
 * Payme `CancelTransaction` (state 2 → -2) yuborganda refund COMPLETED bo'ladi.
 */
@Injectable()
export class PaymeProvider implements PaymentProvider {
  readonly code = 'PAYME' as const;
  readonly name = 'Payme';
  constructor(private readonly config: ConfigService) {}

  enabled() {
    return !!this.config.get('PAYME_MERCHANT_ID') && !!this.config.get('PAYME_KEY');
  }

  get key() {
    return this.config.get<string>('PAYME_KEY') ?? '';
  }

  createCheckout(p: payments, returnUrl?: string) {
    const params = [`m=${this.config.get('PAYME_MERCHANT_ID')}`, `ac.payment_id=${p.id}`, `a=${p.amount}`, ...(returnUrl ? [`c=${returnUrl}`] : [])].join(';');
    const host = this.config.get<boolean>('PAYME_TEST') ? 'https://checkout.test.paycom.uz' : 'https://checkout.paycom.uz';
    return { url: `${host}/${Buffer.from(params).toString('base64')}` };
  }

  async refund() {
    return { status: 'PENDING' as const, provider_refund_id: null, note: 'Cancel the transaction in the Payme merchant cabinet' };
  }
}
