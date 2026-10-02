import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { payments } from '@prisma/client';
import { createHash } from 'crypto';
import { AppException } from '../../../common/errors';
import { PaymentProvider } from './provider';

export const tiyinToSom = (t: bigint) => (Number(t) / 100).toFixed(2);

/** Click SHOP API (prepare/complete) + Merchant API (reversal). Summa so'mda. */
@Injectable()
export class ClickProvider implements PaymentProvider {
  readonly code = 'CLICK' as const;
  readonly name = 'Click';
  private readonly log = new Logger('Click');
  constructor(private readonly config: ConfigService) {}

  enabled() {
    return !!this.config.get('CLICK_SERVICE_ID') && !!this.config.get('CLICK_MERCHANT_ID') && !!this.config.get('CLICK_SECRET_KEY');
  }

  get serviceId() {
    return this.config.get<string>('CLICK_SERVICE_ID') ?? '';
  }

  /** sign_string = md5(click_trans_id + service_id + SECRET + merchant_trans_id [+ merchant_prepare_id] + amount + action + sign_time) */
  sign(f: Record<string, string | undefined>, withPrepare: boolean) {
    const s = [f.click_trans_id, f.service_id, this.config.get('CLICK_SECRET_KEY'), f.merchant_trans_id, withPrepare ? f.merchant_prepare_id : '', f.amount, f.action, f.sign_time].map((x) => x ?? '').join('');
    return createHash('md5').update(s).digest('hex');
  }

  createCheckout(p: payments, returnUrl?: string) {
    const q = new URLSearchParams({ service_id: this.serviceId, merchant_id: this.config.get('CLICK_MERCHANT_ID') ?? '', amount: tiyinToSom(p.amount), transaction_param: p.id, ...(returnUrl ? { return_url: returnUrl } : {}) });
    return { url: `https://my.click.uz/services/pay?${q}` };
  }

  /** To'liq qaytarish — Merchant API reversal; qisman qaytarishni Click qo'llamaydi → kabinetda qo'lda. */
  async refund(p: payments, amount: bigint) {
    const userId = this.config.get<string>('CLICK_MERCHANT_USER_ID');
    const paydoc = (p.provider_payload as { click?: { click_paydoc_id?: string } } | null)?.click?.click_paydoc_id;
    if (!userId || !paydoc || amount !== p.amount - p.refunded_amount || p.refunded_amount > 0n) {
      return { status: 'PENDING' as const, provider_refund_id: null, note: 'Refund manually in the Click merchant cabinet' };
    }
    const ts = Math.floor(Date.now() / 1000).toString();
    const digest = createHash('sha1').update(ts + this.config.get('CLICK_SECRET_KEY')).digest('hex');
    const res = await fetch(`https://api.click.uz/v2/merchant/payment/reversal/${this.serviceId}/${paydoc}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json', Auth: `${userId}:${digest}:${ts}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { error_code?: number; error_note?: string; payment_id?: number } | null;
    if (!res.ok || !body || body.error_code !== 0) {
      this.log.warn(`reversal failed: ${body?.error_code} ${body?.error_note ?? res.status}`);
      throw new AppException('PAYMENT_FAILED', 'Click reversal failed', { provider_error: body?.error_code ?? res.status });
    }
    return { status: 'COMPLETED' as const, provider_refund_id: `click-rv-${body.payment_id ?? paydoc}` };
  }
}
