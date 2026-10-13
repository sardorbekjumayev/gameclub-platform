import { isWithinHours, openState, WorkingHours } from './working-hours';
import { openBillableMinutes } from './open-session';
import { PackageInput, packageAllowsStart, PriceError, promoDiscount, quote, quotePackage, refundPercent, TariffInput, DEFAULT_CANCELLATION_POLICY } from './price-engine';

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

describe('packages', () => {
  // 1 soat 12 000 so'm, paket 3 soat 30 000 so'm
  const pkg = (over: Partial<PackageInput> = {}): PackageInput => ({
    id: 'p1', tariff_id: 't1', name: '3 soat', duration_minutes: 180, price: 3_000_000n, days_of_week: [], ...over,
  });
  const t = base({ price_per_hour: 1_200_000n, min_minutes: 60, max_minutes: 120 });
  it('fixed price and duration, regular amount for savings; tariff min/max ignored', () => {
    const r = quotePackage([t], dev, at('2026-09-28T12:00:00'), pkg(), TZ);
    expect(r.amount).toBe(3_000_000n);
    expect(r.package).toEqual({ id: 'p1', name: '3 soat', duration_minutes: 180, regular_amount: 3_600_000n });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ rule: 'PACKAGE', package_id: 'p1', minutes: 180, amount: 3_000_000, to: at('2026-09-28T15:00:00').toISOString() });
  });
  it('regular amount follows tariff windows', () => {
    const night = base({ price_per_hour: 1_200_000n, rules: [{ days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: '22:00', end_time: '08:00', price_per_hour: 600_000n, kind: 'NIGHT' }] });
    expect(quotePackage([night], dev, at('2026-09-28T21:00:00'), pkg(), TZ).package!.regular_amount).toBe(1_200_000n + 1_200_000n);
  });
  it('package must belong to the tariff selected for the device', () => {
    const vip = base({ id: 't2', room_id: 'r1', price_per_hour: 2_000_000n });
    expect(() => quotePackage([t, vip], dev, at('2026-09-28T12:00:00'), pkg(), TZ)).toThrow(expect.objectContaining({ code: 'PACKAGE_DEVICE' }));
    expect(quotePackage([t, vip], dev, at('2026-09-28T12:00:00'), pkg({ tariff_id: 't2' }), TZ).amount).toBe(3_000_000n);
    expect(() => quotePackage([base({ device_type: 'PS5' })], dev, at('2026-09-28T12:00:00'), pkg(), TZ)).toThrow(expect.objectContaining({ code: 'NO_TARIFF' }));
  });
  it('night window crossing midnight: start must be inside, end may be outside', () => {
    const n = pkg({ start_time: '22:00', end_time: '08:00', duration_minutes: 480 });
    expect(packageAllowsStart(n, at('2026-09-28T23:00:00'), TZ)).toBe(true);
    expect(packageAllowsStart(n, at('2026-09-29T07:30:00'), TZ)).toBe(true);
    expect(packageAllowsStart(n, at('2026-09-29T08:00:00'), TZ)).toBe(false);
    expect(packageAllowsStart(n, at('2026-09-28T21:59:00'), TZ)).toBe(false);
    expect(() => quotePackage([t], dev, at('2026-09-28T12:00:00'), n, TZ)).toThrow(expect.objectContaining({ code: 'PACKAGE_TIME' }));
  });
  it('days of week: crossing window belongs to the day it started', () => {
    // faqat juma (5) kechasi: 2026-10-02 juma
    const fri = pkg({ days_of_week: [5], start_time: '22:00', end_time: '06:00' });
    expect(packageAllowsStart(fri, at('2026-10-02T23:00:00'), TZ)).toBe(true);
    expect(packageAllowsStart(fri, at('2026-10-03T02:00:00'), TZ)).toBe(true); // shanba tongi — juma oynasi
    expect(packageAllowsStart(fri, at('2026-10-03T23:00:00'), TZ)).toBe(false);
    expect(packageAllowsStart(pkg({ days_of_week: [6, 7] }), at('2026-10-02T12:00:00'), TZ)).toBe(false);
    expect(packageAllowsStart(pkg({ days_of_week: [6, 7] }), at('2026-10-03T12:00:00'), TZ)).toBe(true);
  });
});

describe('openBillableMinutes', () => {
  const min = 60_000;
  it('applies the minimum', () => expect(openBillableMinutes(10 * min, 0, 30, 5)).toBe(30));
  it('counts a started minute and rounds up to the step', () => expect(openBillableMinutes(61 * min + 1, 0, 30, 5)).toBe(65));
  it('per-minute billing when step is 1', () => expect(openBillableMinutes(47 * min, 0, 0, 1)).toBe(47));
  it('subtracts paused time', () => expect(openBillableMinutes(90 * min, 30 * 60, 0, 15)).toBe(60));
  it('never bills zero', () => expect(openBillableMinutes(0, 0, 0, 1)).toBe(1));
});
