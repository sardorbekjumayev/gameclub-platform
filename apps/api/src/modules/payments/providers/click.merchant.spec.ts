import { ConfigService } from '@nestjs/config';
import type { payments } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../database/prisma.service';
import { PaymentsService } from '../payments.service';
import { ClickMerchantService } from './click.merchant';
import { ClickProvider, tiyinToSom } from './click.provider';

/** Click SHOP API: sign_string (MD5), prepare/complete xato kodlari. Prisma va PaymentsService mock. */

const ENV: Record<string, string | undefined> = {
  CLICK_SERVICE_ID: '777',
  CLICK_MERCHANT_ID: '888',
  CLICK_SECRET_KEY: 'unit-click-secret',
};
const PID = '0190f1d2-3c4b-7a5e-8f60-123456789abc';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

const config = (env: Record<string, string | undefined> = ENV) => ({ get: (k: string) => env[k] }) as unknown as ConfigService;

const payment = (over: Partial<payments> = {}): payments =>
  ({
    id: PID, provider: 'CLICK', status: 'PENDING', amount: 1_200_050n, refunded_amount: 0n, provider_payload: null, provider_transaction_id: null,
    ...over,
  }) as payments;

function setup(p: payments | null, env = ENV) {
  const store = { p };
  const prisma = {
    payments: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; provider: string } }) => (store.p && store.p.id === where.id && store.p.provider === where.provider ? store.p : null)),
      update: jest.fn(async ({ data }: { data: Partial<payments> }) => (store.p = { ...store.p!, ...data } as payments)),
    },
  } as unknown as PrismaService;
  const handleEvent = jest.fn(async () => ({ processed: true, status: 'PAID', booking_status: 'CONFIRMED' }));
  const provider = new ClickProvider(config(env));
  const svc = new ClickMerchantService(prisma, provider, { handleEvent } as unknown as PaymentsService);
  return { svc, store, prisma, handleEvent, provider };
}

/** Click tomonidan yuboriladigan to'g'ri imzolangan forma. */
function form(action: '0' | '1', over: Record<string, string> = {}, secret = ENV.CLICK_SECRET_KEY!) {
  const f: Record<string, string> = {
    click_trans_id: '99001', service_id: '777', click_paydoc_id: '55001', merchant_trans_id: PID, amount: '12000.50', action, error: '0', error_note: 'Success', sign_time: '2026-10-13 12:00:00',
    ...(action === '1' ? { merchant_prepare_id: '4242' } : {}),
    ...over,
  };
  const prep = action === '1' ? f.merchant_prepare_id : '';
  f.sign_string = over.sign_string ?? md5(`${f.click_trans_id}${f.service_id}${secret}${f.merchant_trans_id}${prep}${f.amount}${f.action}${f.sign_time}`);
  return f;
}

describe('ClickProvider', () => {
  it('sign_string = md5(click_trans_id + service_id + SECRET + merchant_trans_id [+ merchant_prepare_id] + amount + action + sign_time)', () => {
    const p = new ClickProvider(config());
    const f = { click_trans_id: '1', service_id: '777', merchant_trans_id: 'm', merchant_prepare_id: '9', amount: '100.00', action: '0', sign_time: 't' };
    expect(p.sign(f, false)).toBe(md5('1777unit-click-secretm100.000t'));
    expect(p.sign({ ...f, action: '1' }, true)).toBe(md5('1777unit-click-secretm9100.001t'));
    // prepare imzosida merchant_prepare_id qatnashmaydi
    expect(p.sign({ ...f, merchant_prepare_id: 'other' }, false)).toBe(p.sign(f, false));
  });

  it('converts tiyin to so\'m with two decimals (integer math source)', () => {
    expect(tiyinToSom(1_200_050n)).toBe('12000.50');
    expect(tiyinToSom(1n)).toBe('0.01');
    expect(tiyinToSom(100n)).toBe('1.00');
  });

  it('is enabled only with service id, merchant id and secret', () => {
    expect(new ClickProvider(config()).enabled()).toBe(true);
    expect(new ClickProvider(config({ ...ENV, CLICK_SECRET_KEY: undefined })).enabled()).toBe(false);
    expect(new ClickProvider(config({})).enabled()).toBe(false);
  });

  it('checkout url carries amount in so\'m and payment id', () => {
    const url = new URL(new ClickProvider(config()).createCheckout(payment(), 'https://x.uz/back').url);
    expect(url.host).toBe('my.click.uz');
    expect(url.searchParams.get('amount')).toBe('12000.50');
    expect(url.searchParams.get('transaction_param')).toBe(PID);
    expect(url.searchParams.get('service_id')).toBe('777');
    expect(url.searchParams.get('return_url')).toBe('https://x.uz/back');
  });

  it('partial refund (or no merchant user) stays PENDING — manual in cabinet', async () => {
    const p = new ClickProvider(config());
    await expect(p.refund(payment({ status: 'PAID' }), 100n)).resolves.toMatchObject({ status: 'PENDING', provider_refund_id: null });
  });
});

describe('ClickMerchantService.prepare', () => {
  it('valid prepare → error 0, merchant_prepare_id, payment PROCESSING with click state', async () => {
    const { svc, store } = setup(payment());
    const r = (await svc.prepare(form('0'))) as Record<string, unknown>;
    expect(r).toMatchObject({ error: 0, click_trans_id: '99001', merchant_trans_id: PID });
    expect(typeof r.merchant_prepare_id).toBe('number');
    expect(store.p!.status).toBe('PROCESSING');
    expect(store.p!.provider_transaction_id).toBe('99001');
    expect((store.p!.provider_payload as { click: { prepare_id: number } }).click.prepare_id).toBe(r.merchant_prepare_id);
  });

  it('repeated prepare with the same click_trans_id returns the same prepare id', async () => {
    const { svc } = setup(payment());
    const a = (await svc.prepare(form('0'))) as Record<string, unknown>;
    const b = (await svc.prepare(form('0'))) as Record<string, unknown>;
    expect(b.merchant_prepare_id).toBe(a.merchant_prepare_id);
  });

  it('rejects bad signature with -1 and does not touch the payment', async () => {
    const { svc, prisma } = setup(payment());
    expect((await svc.prepare(form('0', { sign_string: 'deadbeef' }))).error).toBe(-1);
    expect((await svc.prepare(form('0', {}, 'wrong-secret'))).error).toBe(-1);
    const f = form('0');
    delete (f as Record<string, string | undefined>).sign_string;
    expect((await svc.prepare(f)).error).toBe(-1);
    // Imzodan keyin summani o'zgartirish ham -1
    expect((await svc.prepare({ ...form('0'), amount: '1.00' })).error).toBe(-1);
    expect(prisma.payments.update).not.toHaveBeenCalled();
  });

  it('wrong action → -3; foreign service_id → -8; disabled provider → -8', async () => {
    const { svc } = setup(payment());
    expect((await svc.prepare(form('1'))).error).toBe(-3);
    expect((await svc.prepare(form('0', { service_id: '111' }))).error).toBe(-8);
    const off = setup(payment(), {});
    expect((await off.svc.prepare(form('0'))).error).toBe(-8);
  });

  it('unknown / malformed merchant_trans_id → -5', async () => {
    const { svc } = setup(payment());
    expect((await svc.prepare(form('0', { merchant_trans_id: '0190f1d2-3c4b-7a5e-8f60-000000000000' }))).error).toBe(-5);
    expect((await svc.prepare(form('0', { merchant_trans_id: "1' OR 1=1" }))).error).toBe(-5);
    // Boshqa provayder to'lovi Click orqali to'lanmaydi
    const other = setup(payment({ provider: 'PAYME' }));
    expect((await other.svc.prepare(form('0'))).error).toBe(-5);
  });

  it('amount mismatch → -2 (so\'m vs tiyin checked exactly)', async () => {
    const { svc } = setup(payment());
    expect((await svc.prepare(form('0', { amount: '12000.49' }))).error).toBe(-2);
    expect((await svc.prepare(form('0', { amount: '1200050' }))).error).toBe(-2);
    expect((await svc.prepare(form('0', { amount: 'abc' }))).error).toBe(-2);
  });

  it('already paid → -4; failed/cancelled → -9', async () => {
    for (const status of ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']) expect((await setup(payment({ status })).svc.prepare(form('0'))).error).toBe(-4);
    for (const status of ['FAILED', 'CANCELLED']) expect((await setup(payment({ status })).svc.prepare(form('0'))).error).toBe(-9);
  });
});

describe('ClickMerchantService.complete', () => {
  const prepared = (prepareId = 4242, extra: Partial<payments> = {}) =>
    payment({ status: 'PROCESSING', provider_transaction_id: '99001', provider_payload: { click: { click_trans_id: '99001', click_paydoc_id: '55001', prepare_id: prepareId } }, ...extra });

  it('valid complete → handleEvent(PAID) and error 0 with merchant_confirm_id', async () => {
    const { svc, handleEvent } = setup(prepared());
    const r = await svc.complete(form('1'));
    expect(r).toMatchObject({ error: 0, merchant_confirm_id: 4242 });
    expect(handleEvent).toHaveBeenCalledWith(expect.objectContaining({ provider: 'CLICK', event_id: 'complete-99001', payment_id: PID, status: 'PAID', provider_transaction_id: '99001' }));
  });

  it('merchant_prepare_id is part of the complete signature', async () => {
    const { svc, handleEvent } = setup(prepared());
    const f = form('1');
    expect((await svc.complete({ ...f, merchant_prepare_id: '4243' })).error).toBe(-1);
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('unknown prepare id / click_trans_id → -6', async () => {
    const { svc, handleEvent } = setup(prepared());
    expect((await svc.complete(form('1', { merchant_prepare_id: '1' }))).error).toBe(-6);
    expect((await svc.complete(form('1', { click_trans_id: '12345' }))).error).toBe(-6);
    expect((await setup(payment()).svc.complete(form('1'))).error).toBe(-6);
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('already paid → -4 without re-processing', async () => {
    const { svc, handleEvent } = setup(prepared(4242, { status: 'PAID' }));
    expect(await svc.complete(form('1'))).toMatchObject({ error: -4, merchant_confirm_id: 4242 });
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('Click-side cancel (error < 0) → handleEvent(FAILED) and -9', async () => {
    const { svc, handleEvent } = setup(prepared());
    expect((await svc.complete(form('1', { error: '-5017' }))).error).toBe(-9);
    expect(handleEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', event_id: 'cancel-99001' }));
  });

  it('failed payment → -9; wrong action → -3', async () => {
    expect((await setup(prepared(4242, { status: 'FAILED' })).svc.complete(form('1'))).error).toBe(-9);
    expect((await setup(prepared()).svc.complete(form('0'))).error).toBe(-3);
  });
});
