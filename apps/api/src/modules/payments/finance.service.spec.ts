import type { payments } from '@prisma/client';
import { AppException } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { FinanceService } from './finance.service';
import { PaymentProviders } from './providers/registry';

/** Moliya matematikasi: komissiya (butun tiyin, pastga yaxlitlash), ledger balansi, refund taqsimoti, bron to'lov holati. */

type Row = Record<string, unknown>;
const CLUB = 'club-1';

function fakeTx(init: { payments?: Partial<payments>[]; booking?: Row; clubBps?: number | null; shift?: Row | null }) {
  const pays = new Map<string, payments>((init.payments ?? []).map((p) => [p.id!, { refunded_amount: 0n, commission_amount: null, club_id: CLUB, user_id: 'u1', booking_id: null, rental_id: null, provider: 'DEMO', method: 'ONLINE_CARD', status: 'PENDING', paid_at: null, ...p } as payments]));
  const booking: Row | undefined = init.booking ? { ...init.booking } : undefined;
  const ledger: Row[] = [];
  const refunds: Row[] = [];
  const inStatus = (s: string, where: { status?: { in: string[] } }) => !where.status || where.status.in.includes(s);
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => []),
    clubs: { findUnique: jest.fn(async () => ({ commission_bps: init.clubBps ?? null })) },
    payments: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({ ...pays.get(where.id)! })),
      findMany: jest.fn(async ({ where, orderBy }: { where: { booking_id?: string; status?: { in: string[] } }; orderBy?: unknown }) => {
        const rows = [...pays.values()].filter((p) => (!where.booking_id || p.booking_id === where.booking_id) && inStatus(p.status, where));
        if (orderBy) rows.sort((a, b) => (b.paid_at?.getTime() ?? 0) - (a.paid_at?.getTime() ?? 0));
        return rows.map((r) => ({ ...r }));
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<payments> }) => {
        const n = { ...pays.get(where.id)!, ...data } as payments;
        pays.set(where.id, n);
        return n;
      }),
      create: jest.fn(async ({ data }: { data: payments }) => {
        const n = { ...({ refunded_amount: 0n, commission_amount: null, paid_at: null } as Partial<payments>), ...data } as payments;
        pays.set(n.id, n);
        return n;
      }),
    },
    bookings: {
      findUniqueOrThrow: jest.fn(async () => ({ ...booking! })),
      update: jest.fn(async ({ data }: { data: Row }) => Object.assign(booking!, data)),
    },
    rentals: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    ledger_entries: { createMany: jest.fn(async ({ data }: { data: Row[] }) => void ledger.push(...data)) },
    refunds: { create: jest.fn(async ({ data }: { data: Row }) => (refunds.push(data), data)) },
    cash_shifts: { findFirst: jest.fn(async () => init.shift ?? null) },
  };
  return { tx, pays, booking, ledger, refunds };
}

function service(defaultBps = 500, providerRefund: 'COMPLETED' | 'PENDING' = 'COMPLETED') {
  const settings = { get: jest.fn(async (k: string) => (k === 'commission.default_bps' ? defaultBps : undefined)) } as unknown as SettingsService;
  const refund = jest.fn(async () => ({ status: providerRefund, provider_refund_id: providerRefund === 'COMPLETED' ? 'rf-1' : null }));
  const providers = { find: jest.fn((code: string) => (code === 'MANUAL' ? null : { code, refund })) } as unknown as PaymentProviders;
  return { fin: new FinanceService({} as PrismaService, settings, providers), refund };
}

const sum = (rows: Row[], dir: string) => rows.filter((r) => r.direction === dir).reduce((a, r) => a + (r.amount as bigint), 0n);

describe('FinanceService.markPaid', () => {
  it('online payment: commission = floor(amount × bps / 10000), club_amount = rest, ledger balanced', async () => {
    const { fin } = service(500);
    const { tx, pays, ledger } = fakeTx({ payments: [{ id: 'p1', amount: 1_200_000n }] });
    await fin.markPaid(tx as never, 'p1', 'prov-1');
    const p = pays.get('p1')!;
    expect(p).toMatchObject({ status: 'PAID', commission_bps: 500, commission_amount: 60_000n, club_amount: 1_140_000n, provider_transaction_id: 'prov-1' });
    expect(sum(ledger, 'DEBIT')).toBe(sum(ledger, 'CREDIT'));
    expect(ledger.map((l) => l.account).sort()).toEqual(['CLUB', 'CUSTOMER', 'PLATFORM']);
  });

  it('rounds commission down to whole tiyin (no fractions)', async () => {
    const { fin } = service();
    const { tx, pays, ledger } = fakeTx({ payments: [{ id: 'p1', amount: 1_999n }], clubBps: 250 });
    await fin.markPaid(tx as never, 'p1');
    // 1999 × 250 / 10000 = 49.975 → 49
    expect(pays.get('p1')!.commission_amount).toBe(49n);
    expect(pays.get('p1')!.club_amount).toBe(1_950n);
    for (const l of ledger) expect(typeof l.amount).toBe('bigint');
    expect(sum(ledger, 'DEBIT')).toBe(sum(ledger, 'CREDIT'));
  });

  it('club-specific bps overrides platform default; zero commission writes no PLATFORM row', async () => {
    const { fin } = service(500);
    const { tx, pays, ledger } = fakeTx({ payments: [{ id: 'p1', amount: 10_000n }], clubBps: 0 });
    await fin.markPaid(tx as never, 'p1');
    expect(pays.get('p1')!.commission_amount).toBe(0n);
    expect(ledger.some((l) => l.account === 'PLATFORM')).toBe(false);
  });

  it('cash / terminal pay no commission', async () => {
    const { fin } = service(500);
    for (const method of ['CASH', 'TERMINAL', 'CARD_TRANSFER'] as const) {
      const { tx, pays } = fakeTx({ payments: [{ id: 'p1', amount: 50_000n, method, provider: 'MANUAL' }] });
      await fin.markPaid(tx as never, 'p1');
      expect(pays.get('p1')!).toMatchObject({ commission_bps: 0, commission_amount: 0n, club_amount: 50_000n });
    }
  });

  it('is a no-op for an already PAID payment (no duplicate ledger)', async () => {
    const { fin } = service();
    const { tx, ledger } = fakeTx({ payments: [{ id: 'p1', amount: 10_000n, status: 'PAID' }] });
    await fin.markPaid(tx as never, 'p1');
    expect(ledger).toHaveLength(0);
  });
});

describe('FinanceService.syncBookingPayment', () => {
  const run = async (total: bigint, pays: Partial<payments>[]) => {
    const { fin } = service();
    const { tx, booking } = fakeTx({ booking: { id: 'b1', total_amount: total }, payments: pays.map((p, i) => ({ id: `p${i}`, booking_id: 'b1', ...p })) });
    await fin.syncBookingPayment(tx as never, 'b1');
    return booking!;
  };

  it('derives UNPAID / PARTIAL / PAID / PARTIALLY_REFUNDED / REFUNDED', async () => {
    expect(await run(1000n, [])).toMatchObject({ payment_status: 'UNPAID', paid_amount: 0n, refund_amount: null });
    expect(await run(1000n, [{ amount: 400n, status: 'PAID' }])).toMatchObject({ payment_status: 'PARTIAL', paid_amount: 400n });
    expect(await run(1000n, [{ amount: 400n, status: 'PAID' }, { amount: 600n, status: 'PAID' }])).toMatchObject({ payment_status: 'PAID', paid_amount: 1000n });
    expect(await run(1000n, [{ amount: 1000n, refunded_amount: 300n, status: 'PARTIALLY_REFUNDED' }])).toMatchObject({ payment_status: 'PARTIALLY_REFUNDED', paid_amount: 700n, refund_amount: 300n });
    expect(await run(1000n, [{ amount: 1000n, refunded_amount: 1000n, status: 'REFUNDED' }])).toMatchObject({ payment_status: 'REFUNDED', paid_amount: 0n, refund_amount: 1000n });
  });

  it('ignores PENDING / FAILED payments', async () => {
    expect(await run(1000n, [{ amount: 1000n, status: 'PENDING' }, { amount: 1000n, status: 'FAILED' }])).toMatchObject({ payment_status: 'UNPAID', paid_amount: 0n });
  });
});

describe('FinanceService.refundPayment', () => {
  const paid = (over: Partial<payments> = {}) => ({ id: 'p1', amount: 100_000n, status: 'PAID', commission_amount: 5_000n, paid_at: new Date(), ...over });

  it('partial then rest: PARTIALLY_REFUNDED → REFUNDED, ledger reverses commission proportionally', async () => {
    const { fin } = service();
    const { tx, pays, ledger, refunds } = fakeTx({ payments: [paid()] });
    await fin.refundPayment(tx as never, 'p1', 30_000n, 'r', 'actor');
    expect(pays.get('p1')!).toMatchObject({ refunded_amount: 30_000n, status: 'PARTIALLY_REFUNDED' });
    // platforma ulushi: 30000 × 5000 / 100000 = 1500
    expect(ledger.find((l) => l.account === 'PLATFORM')).toMatchObject({ direction: 'DEBIT', amount: 1_500n });
    expect(ledger.find((l) => l.account === 'CLUB')).toMatchObject({ direction: 'DEBIT', amount: 28_500n });
    expect(ledger.find((l) => l.account === 'CUSTOMER')).toMatchObject({ direction: 'CREDIT', amount: 30_000n });
    await fin.refundPayment(tx as never, 'p1', 70_000n, 'r', 'actor');
    expect(pays.get('p1')!).toMatchObject({ refunded_amount: 100_000n, status: 'REFUNDED' });
    expect(refunds.map((r) => r.amount)).toEqual([30_000n, 70_000n]);
    expect(refunds.every((r) => r.status === 'COMPLETED' && r.completed_at instanceof Date)).toBe(true);
    // to'liq qaytarishdan keyin platforma jami qaytargani = komissiya
    const platform = ledger.filter((l) => l.account === 'PLATFORM').reduce((a, l) => a + (l.amount as bigint), 0n);
    expect(platform).toBe(5_000n);
  });

  it('cannot exceed refundable balance, refund zero/negative, or refund a non-paid payment', async () => {
    const { fin } = service();
    const { tx } = fakeTx({ payments: [paid({ refunded_amount: 90_000n, status: 'PARTIALLY_REFUNDED' }), { id: 'p2', amount: 10n, status: 'PENDING' }] });
    const err = await fin.refundPayment(tx as never, 'p1', 10_001n, 'r', null).catch((e) => e as AppException);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('REFUND_NOT_ALLOWED');
    expect((err as AppException).details).toEqual({ refundable: 10_000 });
    await expect(fin.refundPayment(tx as never, 'p1', 0n, 'r', null)).rejects.toMatchObject({ code: 'REFUND_NOT_ALLOWED' });
    await expect(fin.refundPayment(tx as never, 'p2', 5n, 'r', null)).rejects.toMatchObject({ code: 'REFUND_NOT_ALLOWED' });
  });

  it('MANUAL (cash) refund completes without calling a provider; CARD_TRANSFER refund is PENDING', async () => {
    const { fin, refund } = service();
    const cash = fakeTx({ payments: [paid({ provider: 'MANUAL', method: 'CASH', commission_amount: 0n })] });
    expect(await fin.refundPayment(cash.tx as never, 'p1', 100n, 'r', null)).toMatchObject({ status: 'COMPLETED' });
    const tr = fakeTx({ payments: [paid({ provider: 'CARD_TRANSFER', method: 'CARD_TRANSFER', commission_amount: 0n })] });
    expect(await fin.refundPayment(tr.tx as never, 'p1', 100n, 'r', null)).toMatchObject({ status: 'PENDING', completed_at: null });
    expect(refund).not.toHaveBeenCalled();
  });

  it('provider PENDING refund (Payme/Click cabinet) still reserves the amount', async () => {
    const { fin, refund } = service(500, 'PENDING');
    const { tx, pays } = fakeTx({ payments: [paid({ provider: 'PAYME' })] });
    expect(await fin.refundPayment(tx as never, 'p1', 100_000n, 'r', null)).toMatchObject({ status: 'PENDING' });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(pays.get('p1')!.refunded_amount).toBe(100_000n);
    // providerDone=true — provayder qayta chaqirilmaydi
    const again = fakeTx({ payments: [paid({ provider: 'PAYME' })] });
    expect(await fin.refundPayment(again.tx as never, 'p1', 1n, 'r', null, undefined, true)).toMatchObject({ status: 'COMPLETED' });
    expect(refund).toHaveBeenCalledTimes(1);
  });
});

describe('FinanceService.refundBooking', () => {
  it('spreads the amount over paid payments, newest first, and returns what was refunded', async () => {
    const { fin } = service();
    const t0 = Date.now();
    const { tx, pays, booking } = fakeTx({
      booking: { id: 'b1', total_amount: 1000n },
      payments: [
        { id: 'old', booking_id: 'b1', amount: 600n, status: 'PAID', paid_at: new Date(t0 - 60_000), provider: 'MANUAL', method: 'CASH', commission_amount: 0n },
        { id: 'new', booking_id: 'b1', amount: 400n, status: 'PAID', paid_at: new Date(t0), provider: 'MANUAL', method: 'CASH', commission_amount: 0n },
      ],
    });
    expect(await fin.refundBooking(tx as never, 'b1', 700n, 'cancel', null)).toBe(700n);
    expect(pays.get('new')!).toMatchObject({ refunded_amount: 400n, status: 'REFUNDED' });
    expect(pays.get('old')!).toMatchObject({ refunded_amount: 300n, status: 'PARTIALLY_REFUNDED' });
    expect(booking).toMatchObject({ paid_amount: 300n, payment_status: 'PARTIALLY_REFUNDED', refund_amount: 700n });
  });

  it('caps at what was paid; zero amount is a no-op', async () => {
    const { fin } = service();
    const { tx } = fakeTx({ booking: { id: 'b1', total_amount: 1000n }, payments: [{ id: 'p', booking_id: 'b1', amount: 200n, status: 'PAID', paid_at: new Date(), provider: 'MANUAL', method: 'CASH', commission_amount: 0n }] });
    expect(await fin.refundBooking(tx as never, 'b1', 0n, 'x', null)).toBe(0n);
    expect(await fin.refundBooking(tx as never, 'b1', 5000n, 'x', null)).toBe(200n);
  });
});

describe('FinanceService offline', () => {
  it('openShift requires an open shift (SHIFT_REQUIRED)', async () => {
    const { fin } = service();
    await expect(fin.openShift(fakeTx({ shift: null }).tx as never, 'op', 'br')).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'SHIFT_REQUIRED' } });
    await expect(fin.openShift(fakeTx({ shift: { id: 's1' } }).tx as never, 'op', 'br')).resolves.toEqual({ id: 's1' });
  });

  it('recordOffline rejects non-positive amounts and pays commission-free', async () => {
    const { fin } = service();
    const { tx } = fakeTx({});
    const base = { club_id: CLUB, branch_id: 'br', amount: 0n, method: 'CASH' as const, operator_id: 'op', shift_id: 's1' };
    await expect(fin.recordOffline(tx as never, base)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const p = await fin.recordOffline(tx as never, { ...base, amount: 25_000n });
    expect(p).toMatchObject({ status: 'PAID', provider: 'MANUAL', commission_amount: 0n, club_amount: 25_000n, shift_id: 's1', received_by: 'op' });
  });
});
