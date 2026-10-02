import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { safeEqual } from '../../../common/utils/crypto';
import { PrismaService } from '../../../database/prisma.service';
import { PaymentsService } from '../payments.service';
import { ClickProvider } from './click.provider';

type ClickForm = Record<string, string | undefined>;
type ClickState = { click_trans_id: string; click_paydoc_id?: string; prepare_id: number; completed?: boolean };

/** Click SHOP API: prepare (action=0) → complete (action=1). Javob JSON, error=0 muvaffaqiyat. */
@Injectable()
export class ClickMerchantService {
  private readonly log = new Logger('ClickMerchant');

  constructor(
    private readonly prisma: PrismaService,
    private readonly click: ClickProvider,
    private readonly payments: PaymentsService,
  ) {}

  private reply(f: ClickForm, error: number, note: string, extra: Record<string, unknown> = {}) {
    return { click_trans_id: f.click_trans_id ?? null, merchant_trans_id: f.merchant_trans_id ?? null, error, error_note: note, ...extra };
  }

  private async load(f: ClickForm, action: '0' | '1') {
    if (!this.click.enabled()) return { err: this.reply(f, -8, 'Error in request from click') };
    if (f.action !== action) return { err: this.reply(f, -3, 'Action not found') };
    const sign = this.click.sign(f, action === '1');
    if (!f.sign_string || !safeEqual(f.sign_string, sign)) return { err: this.reply(f, -1, 'SIGN CHECK FAILED!') };
    if (f.service_id !== this.click.serviceId) return { err: this.reply(f, -8, 'Error in request from click') };
    const id = f.merchant_trans_id ?? '';
    const p = /^[0-9a-f-]{36}$/i.test(id) ? await this.prisma.payments.findFirst({ where: { id, provider: 'CLICK' } }) : null;
    if (!p) return { err: this.reply(f, -5, 'User does not exist') };
    if (BigInt(Math.round(parseFloat(f.amount ?? 'NaN') * 100)) !== p.amount) return { err: this.reply(f, -2, 'Incorrect parameter amount') };
    return { p };
  }

  async prepare(f: ClickForm) {
    const r = await this.load(f, '0');
    if (r.err) return r.err;
    const p = r.p!;
    if (['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status)) return this.reply(f, -4, 'Already paid');
    if (p.status === 'FAILED' || p.status === 'CANCELLED') return this.reply(f, -9, 'Transaction cancelled');
    const prev = (p.provider_payload as { click?: ClickState } | null)?.click;
    const state: ClickState = prev && prev.click_trans_id === f.click_trans_id ? prev : { click_trans_id: f.click_trans_id!, click_paydoc_id: f.click_paydoc_id, prepare_id: Date.now() % 2_000_000_000 };
    await this.prisma.payments.update({
      where: { id: p.id },
      data: { status: 'PROCESSING', provider_transaction_id: f.click_trans_id, provider_payload: { ...((p.provider_payload as object | null) ?? {}), click: state } as Prisma.InputJsonValue },
    });
    return this.reply(f, 0, 'Success', { merchant_prepare_id: state.prepare_id });
  }

  async complete(f: ClickForm) {
    const r = await this.load(f, '1');
    if (r.err) return r.err;
    const p = r.p!;
    const st = (p.provider_payload as { click?: ClickState } | null)?.click;
    if (!st || String(st.prepare_id) !== f.merchant_prepare_id || st.click_trans_id !== f.click_trans_id) return this.reply(f, -6, 'Transaction does not exist');
    if (['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status)) return this.reply(f, -4, 'Already paid', { merchant_confirm_id: st.prepare_id });
    if (p.status === 'FAILED') return this.reply(f, -9, 'Transaction cancelled');
    if (Number(f.error ?? 0) < 0) {
      // Click tomonida bekor qilingan
      await this.payments.handleEvent({ provider: 'CLICK', event_id: `cancel-${f.click_trans_id}`, payment_id: p.id, status: 'FAILED', raw: f });
      return this.reply(f, -9, 'Transaction cancelled');
    }
    const res = await this.payments.handleEvent({ provider: 'CLICK', event_id: `complete-${f.click_trans_id}`, payment_id: p.id, status: 'PAID', provider_transaction_id: f.click_trans_id, raw: f });
    this.log.log(`click complete ${p.id}: ${JSON.stringify({ processed: res.processed })}`);
    return this.reply(f, 0, 'Success', { merchant_confirm_id: st.prepare_id });
  }
}
