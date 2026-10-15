import { PackageInput, TariffInput } from '../../common/domain/price-engine';
import { AppException } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import { PricingService } from './pricing.service';

const TZ = 'Asia/Tashkent';
const at = (local: string) => new Date(`${local}+05:00`);
const dev = { id: 'd1', type: 'PC', room_id: null, category_id: null };
const pkg = (over: Partial<PackageInput> = {}): PackageInput => ({
  id: 'p1', tariff_id: 't1', name: '3 soat', duration_minutes: 180, price: 3_000_000n, days_of_week: [], start_time: null, end_time: null, ...over,
});
const tariff = (over: Partial<TariffInput> = {}): TariffInput => ({
  id: 't1', name: 'Standart', price_per_hour: 1_200_000n, priority: 0, is_active: true, rules: [], packages: [pkg()], ...over,
});

/** Xatoni ushlab, kod va detallarni qaytaradi. */
const caught = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as AppException;
  }
  throw new Error('expected to throw');
};
const caughtAsync = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as AppException;
  }
  throw new Error('expected to reject');
};

describe('PricingService', () => {
  const promotions = { findFirst: jest.fn() };
  const redemptions = { count: jest.fn() };
  const tariffs = { findMany: jest.fn() };
  const prisma = { promotions, promotion_redemptions: redemptions, tariffs } as unknown as PrismaService;
  const svc = new PricingService(prisma);

  beforeEach(() => jest.resetAllMocks());

  describe('tariffs()', () => {
    it('loads only active, non-deleted tariffs of the branch with active packages ordered', async () => {
      tariffs.findMany.mockResolvedValue([]);
      await svc.tariffs('b1');
      expect(tariffs.findMany).toHaveBeenCalledWith({
        where: { branch_id: 'b1', deleted_at: null, is_active: true },
        include: { rules: true, packages: { where: { deleted_at: null, is_active: true }, orderBy: [{ position: 'asc' }, { duration_minutes: 'asc' }] } },
      });
    });
  });

  describe('packages', () => {
    it('findPackage finds a package across tariffs; unknown → VALIDATION_ERROR PACKAGE_NOT_FOUND', () => {
      const ts = [tariff(), tariff({ id: 't2', packages: [pkg({ id: 'p2', tariff_id: 't2' })] }), tariff({ id: 't3', packages: undefined })];
      expect(svc.findPackage(ts, 'p2').tariff_id).toBe('t2');
      const e = caught(() => svc.findPackage(ts, 'nope'));
      expect(e).toBeInstanceOf(AppException);
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.getStatus()).toBe(422);
      expect(e.details).toEqual({ field: 'package_id', reason: 'PACKAGE_NOT_FOUND' });
    });

    it('snapshot is JSON-safe and round-trips back to a package (BigInt price)', () => {
      const p = pkg({ days_of_week: [5, 6], start_time: '22:00', end_time: '08:00' });
      const snap = svc.packageSnapshot(p);
      expect(snap).toEqual({ id: 'p1', name: '3 soat', duration_minutes: 180, price: 3_000_000, tariff_id: 't1', days_of_week: [5, 6], start_time: '22:00', end_time: '08:00' });
      expect(() => JSON.stringify(snap)).not.toThrow();
      const back = svc.packageFromSnapshot(JSON.parse(JSON.stringify({ package: snap, promo: null })));
      expect(back).toEqual({ ...snap, price: 3_000_000n });
      expect(svc.packageSnapshot({ ...p, start_time: undefined, end_time: undefined })).toMatchObject({ start_time: null, end_time: null });
    });

    it('packageFromSnapshot returns null without a package', () => {
      expect(svc.packageFromSnapshot(null)).toBeNull();
      expect(svc.packageFromSnapshot({ package: null })).toBeNull();
      expect(svc.packageFromSnapshot({})).toBeNull();
    });
  });

  describe('quoteDevice()', () => {
    const start = at('2026-09-28T12:00:00');
    const end = at('2026-09-28T13:30:00');

    it('hourly quote without a package; package quote with one', () => {
      expect(svc.quoteDevice([tariff()], dev, start, end, TZ).amount).toBe(1_800_000n);
      const r = svc.quoteDevice([tariff()], dev, start, end, TZ, pkg());
      expect(r.amount).toBe(3_000_000n);
      expect(r.package).toMatchObject({ id: 'p1', regular_amount: 3_600_000n });
    });

    it.each([
      ['NO_TARIFF', [tariff({ device_type: 'PS5' })], null, 'DEVICE_NOT_AVAILABLE', 409, { device_id: 'd1' }],
      ['BELOW_MIN', [tariff({ min_minutes: 120 })], null, 'BOOKING_TOO_EARLY', 422, { min_minutes: 120 }],
      ['ABOVE_MAX', [tariff({ max_minutes: 60 })], null, 'BOOKING_TOO_LATE', 422, { max_minutes: 60 }],
      ['PACKAGE_DEVICE', [tariff()], pkg({ tariff_id: 'other' }), 'VALIDATION_ERROR', 422, { field: 'package_id', reason: 'PACKAGE_DEVICE', device_id: 'd1', package_id: 'p1' }],
      ['PACKAGE_TIME', [tariff()], pkg({ start_time: '22:00', end_time: '08:00' }), 'VALIDATION_ERROR', 422, { field: 'package_id', reason: 'PACKAGE_TIME', package_id: 'p1' }],
    ])('maps PriceError %s to an API error', (_code, ts, p, apiCode, status, details) => {
      const e = caught(() => svc.quoteDevice(ts as TariffInput[], dev, start, end, TZ, p as PackageInput | null));
      expect(e).toBeInstanceOf(AppException);
      expect(e.code).toBe(apiCode);
      expect(e.getStatus()).toBe(status);
      expect(e.details).toEqual(details);
    });

    it('tryQuote swallows errors and returns null', () => {
      expect(svc.tryQuote([tariff({ device_type: 'PS5' })], dev, start, end, TZ)).toBeNull();
      expect(svc.tryQuote([tariff()], dev, start, end, TZ, pkg({ tariff_id: 'x' }))).toBeNull();
      expect(svc.tryQuote([tariff()], dev, start, end, TZ)!.amount).toBe(1_800_000n);
    });
  });

  describe('promo()', () => {
    const ctx = { club_id: 'c1', branch_id: 'b1', user_id: 'u1', subtotal: 2_000_000n, device_types: ['PC'], start: at('2026-09-28T12:00:00'), weekday: 1 };
    const promo = (over: Record<string, unknown> = {}) => ({
      id: 'pr1', code: 'SALE20', club_id: 'c1', type: 'PERCENT', value: 20n, max_discount_amount: null, min_order_amount: null, usage_limit: null, used_count: 0,
      per_user_limit: null, starts_at: null, ends_at: null, applies_to: null, funded_by: 'CLUB', ...over,
    });
    const reason = async (over: Record<string, unknown>, c: Partial<typeof ctx> = {}) => {
      promotions.findFirst.mockResolvedValue(promo(over));
      const e = await caughtAsync(svc.promo('SALE20', { ...ctx, ...c }));
      expect(e.code).toBe('PROMO_INVALID');
      expect(e.getStatus()).toBe(422);
      return e.details.reason;
    };

    it('normalizes the code (trim + upper case) and returns the discount', async () => {
      promotions.findFirst.mockResolvedValue(promo());
      const r = await svc.promo('  sale20 ', ctx);
      expect(promotions.findFirst).toHaveBeenCalledWith({ where: { code: 'SALE20', deleted_at: null, is_active: true } });
      expect(r).toEqual({ promotion_id: 'pr1', code: 'SALE20', discount: 400_000n, funded_by: 'CLUB' });
    });

    it('platform promo (club_id null) works in any club; cap applies', async () => {
      promotions.findFirst.mockResolvedValue(promo({ club_id: null, funded_by: 'PLATFORM', max_discount_amount: 100_000n }));
      expect(await svc.promo('SALE20', { ...ctx, club_id: 'other' })).toMatchObject({ discount: 100_000n, funded_by: 'PLATFORM' });
    });

    it('rejects unknown code', async () => {
      promotions.findFirst.mockResolvedValue(null);
      const e = await caughtAsync(svc.promo('NOPE', ctx));
      expect(e.details).toEqual({ reason: 'NOT_FOUND' });
    });

    it('rejects with the specific reason', async () => {
      expect(await reason({ club_id: 'c2' })).toBe('OTHER_CLUB');
      expect(await reason({ starts_at: new Date(Date.now() + 3600_000) })).toBe('EXPIRED');
      expect(await reason({ ends_at: new Date(Date.now() - 1000) })).toBe('EXPIRED');
      expect(await reason({ usage_limit: 5, used_count: 5 })).toBe('LIMIT_REACHED');
      expect(await reason({ min_order_amount: 2_000_001n })).toBe('MIN_AMOUNT');
      expect(await reason({ applies_to: { branch_ids: ['b2'] } })).toBe('BRANCH');
      expect(await reason({ applies_to: { device_types: ['PC'] } }, { device_types: ['PC', 'PS5'] })).toBe('DEVICE_TYPE');
      expect(await reason({ applies_to: { weekdays: [6, 7] } })).toBe('WEEKDAY');
    });

    it('accepts when restrictions are satisfied (inclusive min amount, empty lists ignored)', async () => {
      promotions.findFirst.mockResolvedValue(promo({
        min_order_amount: 2_000_000n, usage_limit: 5, used_count: 4, starts_at: new Date(Date.now() - 1000), ends_at: new Date(Date.now() + 3600_000),
        applies_to: { branch_ids: ['b1'], device_types: ['PC', 'PS5'], weekdays: [1], },
      }));
      expect((await svc.promo('SALE20', ctx)).discount).toBe(400_000n);
      promotions.findFirst.mockResolvedValue(promo({ applies_to: { branch_ids: [], device_types: [], weekdays: [] } }));
      expect((await svc.promo('SALE20', ctx)).discount).toBe(400_000n);
    });

    it('per-user limit counts redemptions of this user only; guests skip the check', async () => {
      redemptions.count.mockResolvedValue(1);
      expect(await reason({ per_user_limit: 1 })).toBe('USER_LIMIT');
      expect(redemptions.count).toHaveBeenCalledWith({ where: { promotion_id: 'pr1', user_id: 'u1' } });
      redemptions.count.mockClear();
      promotions.findFirst.mockResolvedValue(promo({ per_user_limit: 1 }));
      await svc.promo('SALE20', { ...ctx, user_id: null });
      expect(redemptions.count).not.toHaveBeenCalled();
      redemptions.count.mockResolvedValue(0);
      expect((await svc.promo('SALE20', ctx)).discount).toBe(400_000n);
    });
  });
});
