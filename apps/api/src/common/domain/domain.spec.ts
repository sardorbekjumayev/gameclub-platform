import { isWithinHours, openState, WorkingHours } from './working-hours';
import { PriceError, promoDiscount, quote, refundPercent, TariffInput, DEFAULT_CANCELLATION_POLICY } from './price-engine';

const TZ = 'Asia/Tashkent'; // UTC+5
const at = (local: string) => new Date(`${local}+05:00`);
const dev = { id: 'd1', type: 'PC', room_id: 'r1', category_id: 'c1' };
const base = (over: Partial<TariffInput> = {}): TariffInput => ({
  id: 't1', name: 'Standard', price_per_hour: 2_000_000n, priority: 0, is_active: true, rules: [], ...over,
});

describe('working hours', () => {
  const wh: WorkingHours = { mon: [{ open: '10:00', close: '02:00' }], tue: [{ open: '10:00', close: '02:00' }] };
  it('night window crosses midnight', () => {
    // 2026-09-28 dushanba
    expect(isWithinHours(wh, [], TZ, at('2026-09-28T23:00:00'), at('2026-09-29T01:00:00'))).toBe(true);
    expect(isWithinHours(wh, [], TZ, at('2026-09-29T01:00:00'), at('2026-09-29T03:00:00'))).toBe(false);
    expect(isWithinHours(wh, [], TZ, at('2026-09-28T09:00:00'), at('2026-09-28T11:00:00'))).toBe(false);
  });
  it('exception closes a day', () => {
    expect(isWithinHours(wh, [{ date: '2026-09-28', is_closed: true }], TZ, at('2026-09-28T12:00:00'), at('2026-09-28T13:00:00'))).toBe(false);
  });
  it('always_open merges days and open_until', () => {
    const all = { always_open: true };
    expect(isWithinHours(all, [], TZ, at('2026-09-28T23:00:00'), at('2026-09-29T03:00:00'))).toBe(true);
    expect(openState(wh, [], TZ, at('2026-09-28T23:30:00'))).toEqual({ is_open: true, open_until: at('2026-09-29T02:00:00').toISOString() });
    expect(openState(wh, [], TZ, at('2026-09-28T08:00:00')).is_open).toBe(false);
  });
});

describe('price engine', () => {
  it('base price with ceil rounding', () => {
    const r = quote([base({ price_per_hour: 1_000_001n })], dev, at('2026-09-28T12:00:00'), at('2026-09-28T13:30:00'), TZ);
    expect(r.amount).toBe(1_500_002n); // 90*1000001/60 = 1500001.5 -> ceil
  });
  it('night rule crossing midnight splits into segments', () => {
    const t = base({ rules: [{ days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: '22:00', end_time: '08:00', price_per_hour: 1_000_000n, kind: 'NIGHT' }] });
    const r = quote([t], dev, at('2026-09-28T21:00:00'), at('2026-09-28T23:00:00'), TZ);
    expect(r.segments.map((s) => [s.rule, s.minutes])).toEqual([['BASE', 60], ['NIGHT', 60]]);
    expect(r.amount).toBe(3_000_000n);
    // ertasi kuni 01:00 — oldingi kun boshlangan tun oynasi
    expect(quote([t], dev, at('2026-09-29T01:00:00'), at('2026-09-29T02:00:00'), TZ).amount).toBe(1_000_000n);
  });
  it('weekend beats standard, holiday date beats weekday', () => {
    const t = base({
      rules: [
        { days_of_week: [6, 7], start_time: '00:00', end_time: '00:00', price_per_hour: 3_000_000n, kind: 'WEEKEND' },
        { days_of_week: [], start_time: '00:00', end_time: '00:00', price_per_hour: 5_000_000n, kind: 'HOLIDAY', date: new Date('2026-10-01') },
      ],
    });
    expect(quote([t], dev, at('2026-10-03T12:00:00'), at('2026-10-03T13:00:00'), TZ).amount).toBe(3_000_000n); // shanba
    expect(quote([t], dev, at('2026-10-01T12:00:00'), at('2026-10-01T13:00:00'), TZ).amount).toBe(5_000_000n); // bayram
  });
  it('most specific tariff wins, then priority', () => {
    const tariffs = [base(), base({ id: 't2', category_id: 'c1', price_per_hour: 4_000_000n }), base({ id: 't3', device_type: 'PC', price_per_hour: 9n, priority: 10 })];
    expect(quote(tariffs, dev, at('2026-09-28T12:00:00'), at('2026-09-28T13:00:00'), TZ).tariff_id).toBe('t2');
  });
  it('min minutes enforced; no tariff -> error', () => {
    expect(() => quote([base({ min_minutes: 60 })], dev, at('2026-09-28T12:00:00'), at('2026-09-28T12:30:00'), TZ)).toThrow(PriceError);
    expect(() => quote([base({ device_type: 'PS5' })], dev, at('2026-09-28T12:00:00'), at('2026-09-28T13:00:00'), TZ)).toThrow(PriceError);
  });
  it('promo and refund policy', () => {
    expect(promoDiscount({ type: 'PERCENT', value: 20n, max_discount_amount: 500_000n }, 5_000_000n)).toBe(500_000n);
    expect(promoDiscount({ type: 'FIXED', value: 9_000_000n }, 5_000_000n)).toBe(5_000_000n);
    const start = at('2026-09-28T20:00:00');
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T17:00:00'))).toBe(100);
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T19:00:00'))).toBe(50);
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T19:50:00'))).toBe(0);
  });
});
