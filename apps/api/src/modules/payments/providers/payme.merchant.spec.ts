import { ConfigService } from '@nestjs/config';
import type { payments } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { FinanceService } from '../finance.service';
import { PaymentsService } from '../payments.service';
import { PaymeMerchantService } from './payme.merchant';
import { PaymeProvider } from './payme.provider';

/** Payme merchant JSON-RPC protokoli: auth, xato kodlari, holat mashinasi, idempotentlik. Prisma — xotiradagi jadval. */

const KEY = 'unit-payme-key';
const ENV: Record<string, string | boolean | undefined> = { PAYME_MERCHANT_ID: 'm-unit', PAYME_KEY: KEY, PAYME_TEST: true };
const PID = '0190f1d2-3c4b-7a5e-8f60-123456789abc';
const PID2 = '0190f1d2-3c4b-7a5e-8f60-123456789abd';
const AUTH = `Basic ${Buffer.from(`Paycom:${KEY}`).toString('base64')}`;

const config = (env = ENV) => ({ get: (k: string) => env[k] }) as unknown as ConfigService;

const payment = (over: Partial<payments> = {}): payments =>
  ({ id: PID, provider: 'PAYME', status: 'PENDING', amount: 1_200_000n, refunded_amount: 0n, provider_payload: null, provider_transaction_id: null, booking_id: null, created_at: new Date(), ...over }) as payments;

function setup(rows: payments[] = [payment()], env = ENV) {
  const db = new Map(rows.map((r) => [r.id, { ...r }]));
  const match = (r: payments, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'not' in (v as object)) return (r as Record<string, unknown>)[k] !== (v as { not: unknown }).not;
      return (r as Record<string, unknown>)[k] === v;
    });
  const payments = {
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => [...db.values()].find((r) => match(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => [...db.values()].filter((r) => match(r, where))),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => db.get(where.id)!),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<payments> }) => {
      const next = { ...db.get(where.id)!, ...data } as payments;
      db.set(where.id, next);
      return next;
    }),
  };
  const refunds = { findMany: jest.fn(async () => []), updateMany: jest.fn() };
  const prisma = { payments, refunds, $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ payments, refunds })) } as unknown as PrismaService;
  const handleEvent = jest.fn(async (ev: { payment_id: string; status: 'PAID' | 'FAILED' }) => {
    const r = db.get(ev.payment_id)!;
    db.set(r.id, { ...r, status: ev.status } as payments);
    return { processed: true, status: ev.status, booking_status: null };
  });
  const refundPayment = jest.fn(async (_tx: unknown, id: string, amount: bigint, ..._rest: unknown[]) => {
    const r = db.get(id)!;
    db.set(id, { ...r, refunded_amount: r.refunded_amount + amount, status: 'REFUNDED' } as payments);
  });
  const finance = { refundPayment, syncBookingPayment: jest.fn() } as unknown as FinanceService;
  const svc = new PaymeMerchantService(prisma, new PaymeProvider(config(env)), { handleEvent } as unknown as PaymentsService, finance);
  const rpc = (method: string, params: Record<string, unknown>, auth: string | null = AUTH) =>
    svc.handle({ id: 7, method, params }, auth ?? undefined) as Promise<{ id: number; result?: Record<string, unknown>; error?: { code: number; message: Record<string, string>; data?: string } }>;
  return { svc, db, rpc, handleEvent, refundPayment, refunds };
}

const acc = (id = PID) => ({ payment_id: id });

describe('PaymeMerchantService — auth & protocol errors', () => {
  it('missing / wrong / non-Basic authorization → -32504', async () => {
    const { rpc } = setup();
    for (const auth of [null, 'Bearer x', `Basic ${Buffer.from('Paycom:wrong').toString('base64')}`, `Basic ${Buffer.from(`Other:${KEY}`).toString('base64')}`]) {
      const r = await rpc('CheckPerformTransaction', { amount: 1_200_000, account: acc() }, auth);
      expect(r.error?.code).toBe(-32504);
      expect(r.id).toBe(7);
      expect(r.result).toBeUndefined();
    }
  });

  it('disabled provider (no key) rejects even a "valid" header', async () => {
    const { rpc } = setup([payment()], { PAYME_MERCHANT_ID: undefined, PAYME_KEY: undefined });
    const r = await rpc('CheckPerformTransaction', { amount: 1_200_000, account: acc() }, `Basic ${Buffer.from('Paycom:').toString('base64')}`);
    expect(r.error?.code).toBe(-32504);
  });

  it('unknown method → -32601; errors carry uz/ru/en messages', async () => {
    const r = await setup().rpc('ChangePassword', {});
    expect(r.error?.code).toBe(-32601);
    expect(Object.keys(r.error!.message).sort()).toEqual(['en', 'ru', 'uz']);
  });
});

describe('CheckPerformTransaction', () => {
  it('allows a pending payment with exact tiyin amount', async () => {
    expect((await setup().rpc('CheckPerformTransaction', { amount: 1_200_000, account: acc() })).result).toEqual({ allow: true });
  });

  it('wrong amount → -31001 (also non-numeric / missing)', async () => {
    const { rpc } = setup();
    for (const amount of [1_199_999, 12_000, 'abc', undefined]) expect((await rpc('CheckPerformTransaction', { amount, account: acc() })).error?.code).toBe(-31001);
  });

  it('unknown / malformed account → -31050 with data=payment_id', async () => {
    const { rpc } = setup();
    for (const account of [acc(PID2), { payment_id: 'nope' }, {}, undefined]) {
      const r = await rpc('CheckPerformTransaction', { amount: 1_200_000, account });
      expect(r.error).toMatchObject({ code: -31050, data: 'payment_id' });
    }
  });

  it('payment of another provider is unknown for Payme', async () => {
    const r = await setup([payment({ provider: 'CLICK' })]).rpc('CheckPerformTransaction', { amount: 1_200_000, account: acc() });
    expect(r.error?.code).toBe(-31050);
  });

  it('already paid / failed → -31008', async () => {
    for (const status of ['PAID', 'FAILED', 'REFUNDED']) {
      expect((await setup([payment({ status })]).rpc('CheckPerformTransaction', { amount: 1_200_000, account: acc() })).error?.code).toBe(-31008);
    }
  });
});

describe('Create → Perform → Check → Cancel', () => {
  it('CreateTransaction is idempotent for the same Payme id', async () => {
    const { rpc, db } = setup();
    const a = await rpc('CreateTransaction', { id: 'tx-1', time: 1_700_000_000_000, amount: 1_200_000, account: acc() });
    expect(a.result).toMatchObject({ transaction: PID, state: 1 });
    expect(db.get(PID)!.status).toBe('PROCESSING');
    expect(db.get(PID)!.provider_transaction_id).toBe('tx-1');
    const b = await rpc('CreateTransaction', { id: 'tx-1', time: 1_700_000_000_000, amount: 1_200_000, account: acc() });
    expect(b.result).toEqual(a.result);
  });

  it('second Payme transaction for a busy payment → -31051', async () => {
    const { rpc } = setup();
    await rpc('CreateTransaction', { id: 'tx-1', time: 1, amount: 1_200_000, account: acc() });
    const r = await rpc('CreateTransaction', { id: 'tx-2', time: 2, amount: 1_200_000, account: acc() });
    expect(r.error).toMatchObject({ code: -31051, data: 'payment_id' });
  });

  it('CreateTransaction validates amount and account', async () => {
    const { rpc } = setup();
    expect((await rpc('CreateTransaction', { id: 'tx-1', time: 1, amount: 5, account: acc() })).error?.code).toBe(-31001);
    expect((await rpc('CreateTransaction', { id: 'tx-1', time: 1, amount: 1_200_000, account: acc(PID2) })).error?.code).toBe(-31050);
  });

  it('PerformTransaction pays once; repeat returns the same perform_time without re-processing', async () => {
    const { rpc, handleEvent } = setup();
    await rpc('CreateTransaction', { id: 'tx-1', time: 1, amount: 1_200_000, account: acc() });
    const p1 = await rpc('PerformTransaction', { id: 'tx-1' });
    expect(p1.result).toMatchObject({ transaction: PID, state: 2 });
    expect(p1.result!.perform_time).toEqual(expect.any(Number));
    expect(handleEvent).toHaveBeenCalledTimes(1);
    expect(handleEvent).toHaveBeenCalledWith(expect.objectContaining({ provider: 'PAYME', event_id: 'perform-tx-1', status: 'PAID', payment_id: PID }));
    const p2 = await rpc('PerformTransaction', { id: 'tx-1' });
    expect(p2.result).toEqual(p1.result);
    expect(handleEvent).toHaveBeenCalledTimes(1);
    // CreateTransaction endi bajarilgan tranzaksiya uchun -31008
    expect((await rpc('CreateTransaction', { id: 'tx-1', time: 1, amount: 1_200_000, account: acc() })).error?.code).toBe(-31008);
  });

  it('unknown transaction → -31003 for Perform/Cancel/Check', async () => {
    const { rpc } = setup();
    for (const m of ['PerformTransaction', 'CancelTransaction', 'CheckTransaction']) expect((await rpc(m, { id: 'missing', reason: 3 })).error?.code).toBe(-31003);
  });

  it('CheckTransaction reflects state transitions', async () => {
    const { rpc } = setup();
    const c = await rpc('CreateTransaction', { id: 'tx-1', time: 1, amount: 1_200_000, account: acc() });
    expect((await rpc('CheckTransaction', { id: 'tx-1' })).result).toMatchObject({ state: 1, create_time: c.result!.create_time, perform_time: 0, cancel_time: 0, reason: null, transaction: PID });
    await rpc('PerformTransaction', { id: 'tx-1' });
    expect((await rpc('CheckTransaction', { id: 'tx-1' })).result).toMatchObject({ state: 2 });
  });

  it('CancelTransaction before perform → state -1 and FAILED event; repeat is stable', async () => {
    const { rpc, handleEvent, db } = setup();
    await rpc('CreateTransaction', { id: 'tx-1', time: 1, amount: 1_200_000, account: acc() });
    const c1 = await rpc('CancelTransaction', { id: 'tx-1', reason: 3 });
    expect(c1.result).toMatchObject({ transaction: PID, state: -1 });
    expect(handleEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', event_id: 'cancel-tx-1' }));
    expect(db.get(PID)!.status).toBe('FAILED');
    const c2 = await rpc('CancelTransaction', { id: 'tx-1', reason: 3 });
    expect(c2.result).toEqual(c1.result);
    expect((await rpc('CheckTransaction', { id: 'tx-1' })).result).toMatchObject({ state: -1, reason: 3 });
    // Bekor qilingan tranzaksiyani bajarib bo'lmaydi
    expect((await rpc('PerformTransaction', { id: 'tx-1' })).error?.code).toBe(-31008);
  });

  it('CancelTransaction after perform → state -2, refund the rest with providerDone=true', async () => {
    const { rpc, refundPayment } = setup();
    await rpc('CreateTransaction', { id: 'tx-1', time: 1, amount: 1_200_000, account: acc() });
    await rpc('PerformTransaction', { id: 'tx-1' });
    const c = await rpc('CancelTransaction', { id: 'tx-1', reason: 5 });
    expect(c.result).toMatchObject({ state: -2 });
    expect(refundPayment).toHaveBeenCalledTimes(1);
    expect(refundPayment.mock.calls[0][1]).toBe(PID);
    expect(refundPayment.mock.calls[0][2]).toBe(1_200_000n);
    expect(refundPayment.mock.calls[0][3 + 3]).toBe(true);
    // takror — refund qayta bajarilmaydi
    expect((await rpc('CancelTransaction', { id: 'tx-1', reason: 5 })).result).toEqual(c.result);
    expect(refundPayment).toHaveBeenCalledTimes(1);
  });

  it('transaction older than 12h cannot be performed (timeout → -31008, state -1 reason 4)', async () => {
    const old = Date.now() - 13 * 3600_000;
    const { rpc, handleEvent } = setup([
      payment({ status: 'PROCESSING', provider_transaction_id: 'tx-old', provider_payload: { payme: { id: 'tx-old', time: old, create_time: old, perform_time: 0, cancel_time: 0, state: 1, reason: null } } }),
    ]);
    expect((await rpc('PerformTransaction', { id: 'tx-old' })).error?.code).toBe(-31008);
    expect(handleEvent).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', event_id: 'timeout-tx-old' }));
    expect((await rpc('CheckTransaction', { id: 'tx-old' })).result).toMatchObject({ state: -1, reason: 4 });
  });
});

describe('GetStatement', () => {
  it('returns Payme transactions whose Payme time is within [from, to]', async () => {
    const tx = (id: string, time: number) => ({ payme: { id, time, create_time: time, perform_time: 0, cancel_time: 0, state: 1, reason: null } });
    const { rpc } = setup([
      payment({ id: PID, provider_transaction_id: 'a', provider_payload: tx('a', 1000) }),
      payment({ id: PID2, provider_transaction_id: 'b', provider_payload: tx('b', 5000) }),
    ]);
    const r = await rpc('GetStatement', { from: 500, to: 2000 });
    const list = r.result!.transactions as { id: string; amount: number; account: { payment_id: string } }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'a', amount: 1_200_000, account: { payment_id: PID }, transaction: PID, state: 1 });
    expect(Number.isInteger(list[0].amount)).toBe(true);
    expect(((await rpc('GetStatement', { from: 0, to: 10_000 })).result!.transactions as unknown[]).length).toBe(2);
  });
});

describe('PaymeProvider', () => {
  it('checkout url encodes merchant, payment id and tiyin amount in base64', () => {
    const url = new PaymeProvider(config()).createCheckout(payment(), 'https://x.uz/r').url;
    expect(url.startsWith('https://checkout.test.paycom.uz/')).toBe(true);
    const decoded = Buffer.from(url.split('/').pop()!, 'base64').toString();
    expect(decoded).toBe(`m=m-unit;ac.payment_id=${PID};a=1200000;c=https://x.uz/r`);
  });

  it('refund via API is PENDING (done in Payme cabinet)', async () => {
    await expect(new PaymeProvider(config()).refund()).resolves.toMatchObject({ status: 'PENDING', provider_refund_id: null });
  });
});
