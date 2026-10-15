import { randomUUID } from 'crypto';
import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';
import { newClub, newCustomer } from './utils/flows';

/**
 * Arenda tugmasini ikki marta bosish (web `useSubmitKey`): bir xil tana + bir xil Idempotency-Key → server birinchi
 * arendani qaytaradi, ikkinchisi yaratilmaydi va dona band qilinmaydi. Tana o'zgarsa (yangi kalit) — yangi arenda.
 */
describe('Rentals double tap (e2e)', () => {
  const h = new Harness();
  let A: TestClub;
  let prisma: PrismaService;
  let itemId: string;
  const W = slot(180);

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    A = await newClub(h, { devices: 1 });
    const r = await h.http
      .post(api(`/branches/${A.branchId}/rental-items`))
      .set(bearer(A.owner))
      .send({ name: 'PlayStation 5', type: 'PS5', quantity: 3, price_per_hour: 3_000_000, min_hours: 2 })
      .expect(201);
    itemId = r.body.data.id;
  }, 120_000);

  afterAll(() => h.stop());

  const rent = (token: string, key: string, body: Record<string, unknown> = {}) =>
    h.http.post(api('/rentals')).set(bearer(token)).set('Idempotency-Key', key).send({ item_id: itemId, rate_unit: 'HOUR', units: 2, start_at: W, ...body });
  const availableUnits = async () => {
    const q = await h.http.get(api(`/rental-items/${itemId}/quote?rate_unit=HOUR&units=2&start_at=${encodeURIComponent(W)}`)).expect(200);
    return q.body.data.available_units as number;
  };

  it('sequential double submit (same body + same key) returns the same rental and creates only one', async () => {
    const c = await newCustomer(h);
    const customerId = (await prisma.users.findUniqueOrThrow({ where: { phone: c.phone } })).id;
    const before = await availableUnits();
    const key = randomUUID();
    const body = { notes: 'Ikki marta bosildi' };

    const first = await rent(c.token, key, body).expect(201);
    const second = await rent(c.token, key, body);
    expect([200, 201]).toContain(second.status);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.code).toBe(first.body.data.code);
    expect(await prisma.rentals.count({ where: { customer_id: customerId } })).toBe(1);
    expect(await prisma.rentals.count({ where: { idempotency_key: key } })).toBe(1);
    expect(await availableUnits()).toBe(before - 1);

    // Forma o'zgardi → web yangi kalit beradi → ikkinchi (alohida) arenda
    const other = await rent(c.token, randomUUID(), { notes: 'Ikkinchi konsol' }).expect(201);
    expect(other.body.data.id).not.toBe(first.body.data.id);
    expect(await prisma.rentals.count({ where: { customer_id: customerId } })).toBe(2);
  });

  it('parallel retries with the same key create exactly one rental', async () => {
    const c = await newCustomer(h);
    const key = randomUUID();
    const res = await Promise.all([1, 2, 3, 4].map(() => rent(c.token, key)));
    const ok = res.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    for (const r of res.filter((x) => x.status !== 201)) expect({ status: r.status, code: r.body.error.code }).toEqual({ status: 409, code: 'CONFLICT' });
    expect(await prisma.rentals.count({ where: { idempotency_key: key } })).toBe(1);
  });
});
