import { api, bearer, Harness, TestClub, uniq } from './utils/harness';

jest.setTimeout(120_000);

/**
 * Phase 4 discovery: nearby/search/map/summary (PostGIS). Filiallar tasodifiy, seed ma'lumotlardan
 * uzoq hududga qo'yiladi; masofalar ~1 km = 0.008983° kenglik.
 */
describe('Discovery (e2e)', () => {
  const h = new Harness();
  // OTP IP limiti (10/soat) parallel ishlayotgan suite'lar orasida tugab qolmasin
  const otpLogin = h.otpLogin.bind(h);
  h.otpLogin = async (phone?: string) => {
    await h.resetRateLimits();
    return otpLogin(phone);
  };
  const LAT = 38.6 + Math.random() * 0.4;
  const LNG = 65.2 + Math.random() * 0.4;
  const KM = 1000 / 111_320;
  const tag = uniq('disc').replace(/-/g, '');
  const at = (km: number) => ({ latitude: Number((LAT + km * KM).toFixed(6)), longitude: LNG });

  let near: TestClub; // 1 km, PC, arzon
  let far: TestClub; // 5 km, PS5, qimmat
  let suspended: TestClub; // 2 km
  let draft: TestClub; // 1.5 km
  let closed: TestClub; // 2.5 km
  let inactiveBranch: string; // near klubining 0.5 km dagi INACTIVE filiali
  let second: string; // near klubining 3 km dagi faol ikkinchi filiali

  const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((x) => x.id);
  const ours = (list: string[]) => list.filter((id) => [near.branchId, far.branchId, suspended.branchId, draft.branchId, closed.branchId, inactiveBranch, second].includes(id));

  beforeAll(async () => {
    await h.start();
    near = await h.club({ name: `Disc Near ${tag}`, devices: 2, pricePerHour: 1_000_000, branch: { ...at(1), name: `Near ${tag}`, amenities: ['wifi', 'parking'] } });
    far = await h.club({ name: `Disc Far ${tag}`, devices: 1, deviceType: 'PS5', pricePerHour: 3_000_000, branch: { ...at(5), name: `Far ${tag}` } });
    suspended = await h.club({ name: `Disc Susp ${tag}`, devices: 1, branch: { ...at(2), name: `Susp ${tag}` } });
    draft = await h.club({ name: `Disc Draft ${tag}`, devices: 1, approve: false, branch: { ...at(1.5), name: `Draft ${tag}` } });
    closed = await h.club({ name: `Disc Closed ${tag}`, devices: 1, branch: { ...at(2.5), name: `Closed ${tag}` } });
    await h.http.post(api(`/admin/clubs/${suspended.clubId}/suspend`)).set(bearer(h.admin)).send({ reason: 'e2e' }).expect(201);
    await h.http.post(api(`/admin/clubs/${closed.clubId}/close`)).set(bearer(h.admin)).send({ reason: 'e2e' }).expect(201);
    inactiveBranch = (await h.http.post(api(`/clubs/${near.clubId}/branches`)).set(bearer(near.owner))
      .send({ name: `Inactive ${tag}`, address: 'Qishloq 1', ...at(0.5), working_hours: { always_open: true } }).expect(201)).body.data.id;
    await h.http.patch(api(`/branches/${inactiveBranch}`)).set(bearer(near.owner)).send({ status: 'INACTIVE' }).expect(200);
    second = (await h.http.post(api(`/clubs/${near.clubId}/branches`)).set(bearer(near.owner))
      .send({ name: `Second ${tag}`, address: 'Qishloq 2', ...at(3), working_hours: { always_open: true } }).expect(201)).body.data.id;
  });

  afterAll(() => h.stop());

  describe('nearby', () => {
    it('returns only active branches of active clubs, ordered by distance with correct distance_m', async () => {
      const r = await h.http.get(api('/branches/nearby')).query({ lat: LAT, lng: LNG, radius: 20_000, limit: 100 }).expect(200);
      expect(ours(ids(r))).toEqual([near.branchId, second, far.branchId]);
      const byId = Object.fromEntries(r.body.data.map((x: { id: string; distance_m: number }) => [x.id, x.distance_m]));
      expect(Math.abs(byId[near.branchId] - 1000)).toBeLessThan(15);
      expect(Math.abs(byId[second] - 3000)).toBeLessThan(30);
      expect(Math.abs(byId[far.branchId] - 5000)).toBeLessThan(50);
      const ds = r.body.data.map((x: { distance_m: number }) => x.distance_m);
      expect(ds).toEqual([...ds].sort((a: number, b: number) => a - b));
      expect(r.body.meta).toMatchObject({ page: 1, limit: 100 });
    });

    it('card fields: club info, price, device counts, open state; no private fields', async () => {
      const r = await h.http.get(api('/branches/nearby')).query({ lat: LAT, lng: LNG, radius: 2000 }).expect(200);
      const card = r.body.data.find((x: { id: string }) => x.id === near.branchId);
      expect(card).toMatchObject({
        club: { id: near.clubId, name: `Disc Near ${tag}` },
        min_price_per_hour: 1_000_000, device_types: ['PC'], total_devices: 2, available_devices_count: 2, is_open_now: true,
        latitude: at(1).latitude, longitude: LNG, amenities: ['wifi', 'parking'],
      });
      expect(JSON.stringify(r.body.data)).not.toMatch(/owner_id|transfer_card|booking_settings|password/);
    });

    it('radius limits results; default radius is 10 km', async () => {
      const r = await h.http.get(api('/branches/nearby')).query({ lat: LAT, lng: LNG, radius: 3500 }).expect(200);
      expect(ours(ids(r))).toEqual([near.branchId, second]);
      const def = await h.http.get(api('/discovery/nearby')).query({ lat: LAT + 8 * KM, lng: LNG }).expect(200);
      // 8 km shimoldan: far 3 km, second 5 km, near 7 km — hammasi 10 km ichida
      expect(ours(ids(def))).toEqual([far.branchId, second, near.branchId]);
      const tiny = await h.http.get(api('/branches/nearby')).query({ lat: LAT, lng: LNG, radius: 500 }).expect(200);
      expect(ours(ids(tiny))).toEqual([]);
    });

    it('validates query', async () => {
      for (const q of [{}, { lat: LAT }, { lat: 91, lng: LNG }, { lat: LAT, lng: 200 }, { lat: 'abc', lng: LNG }, { lat: LAT, lng: LNG, radius: 50 }, { lat: LAT, lng: LNG, radius: 500_000 }, { lat: LAT, lng: LNG, limit: 0 }, { lat: LAT, lng: LNG, foo: 1 }]) {
        const r = await h.http.get(api('/branches/nearby')).query(q);
        expect({ q, status: r.status }).toEqual({ q, status: 422 });
      }
    });

    it('suspending hides the club; reactivating brings it back', async () => {
      await h.http.post(api(`/admin/clubs/${near.clubId}/suspend`)).set(bearer(h.admin)).send({ reason: 'e2e' }).expect(201);
      let r = await h.http.get(api('/branches/nearby')).query({ lat: LAT, lng: LNG, radius: 20_000 }).expect(200);
      expect(ours(ids(r))).toEqual([far.branchId]);
      await h.http.post(api(`/admin/clubs/${near.clubId}/reactivate`)).set(bearer(h.admin)).send({}).expect(201);
      r = await h.http.get(api('/branches/nearby')).query({ lat: LAT, lng: LNG, radius: 20_000 }).expect(200);
      expect(ours(ids(r))).toEqual([near.branchId, second, far.branchId]);
    });
  });

  describe('search', () => {
    it('finds by club/branch name; never inactive ones', async () => {
      const r = await h.http.get(api('/branches/search')).query({ q: tag, limit: 100 }).expect(200);
      expect(ours(ids(r)).sort()).toEqual([near.branchId, second, far.branchId].sort());
      expect(r.body.meta.total).toBe(3);
      const susp = await h.http.get(api('/branches/search')).query({ q: `Susp ${tag}` }).expect(200);
      expect(susp.body.data).toEqual([]);
    });

    it('filters: device_type, price, amenities, radius; sorts by price and distance', async () => {
      const ps5 = await h.http.get(api('/branches/search')).query({ q: tag, device_type: 'PS5' }).expect(200);
      expect(ids(ps5)).toEqual([far.branchId]);
      const cheap = await h.http.get(api('/branches/search')).query({ q: tag, price_max: 1_500_000 }).expect(200);
      expect(ids(cheap)).toEqual([near.branchId]); // second filialda tarif yo'q
      const pricey = await h.http.get(api('/branches/search')).query({ q: tag, price_min: 2_000_000 }).expect(200);
      expect(ids(pricey)).toEqual([far.branchId]);
      const am = await h.http.get(api('/branches/search')).query({ q: tag, amenities: 'wifi,parking' }).expect(200);
      expect(ids(am)).toEqual([near.branchId]);
      const byPrice = await h.http.get(api('/branches/search')).query({ q: tag, sort: 'price' }).expect(200);
      expect(ids(byPrice)).toEqual([near.branchId, far.branchId, second]);
      const byDist = await h.http.get(api('/branches/search')).query({ q: tag, lat: LAT + 6 * KM, lng: LNG }).expect(200);
      expect(ids(byDist)).toEqual([far.branchId, second, near.branchId]);
      const within = await h.http.get(api('/branches/search')).query({ q: tag, lat: LAT, lng: LNG, radius: 2000 }).expect(200);
      expect(ids(within)).toEqual([near.branchId]);
      const avail = await h.http.get(api('/branches/search')).query({ q: tag, available_now: true }).expect(200);
      expect(ids(avail).sort()).toEqual([near.branchId, far.branchId].sort());
    });

    it('pagination and validation', async () => {
      const p1 = await h.http.get(api('/branches/search')).query({ q: tag, sort: 'price', limit: 2, page: 1 }).expect(200);
      const p2 = await h.http.get(api('/branches/search')).query({ q: tag, sort: 'price', limit: 2, page: 2 }).expect(200);
      expect([...ids(p1), ...ids(p2)]).toEqual([near.branchId, far.branchId, second]);
      expect(p2.body.meta).toMatchObject({ page: 2, limit: 2, total: 3 });
      for (const q of [{ sort: 'cheapest' }, { rating_min: 6 }, { price_min: -1 }, { limit: 101 }, { page: 0 }, { q: 'x'.repeat(101) }]) {
        const r = await h.http.get(api('/branches/search')).query(q);
        expect({ q, status: r.status }).toEqual({ q, status: 422 });
      }
      // SQL injection urinishi oddiy matn sifatida qidiriladi
      await h.http.get(api('/branches/search')).query({ q: "' OR 1=1 --" }).expect(200).expect((res) => expect(res.body.data).toEqual([]));
    });
  });

  describe('map', () => {
    const bbox = (w: number, s: number, e: number, n: number) => [w, s, e, n].map((v) => v.toFixed(6)).join(',');

    it('returns markers inside bbox only, for active clubs', async () => {
      const r = await h.http.get(api('/branches/map')).query({ bbox: bbox(LNG - 0.01, LAT, LNG + 0.01, LAT + 6 * KM), zoom: 12 }).expect(200);
      expect(ours(ids(r)).sort()).toEqual([near.branchId, second, far.branchId].sort());
      const marker = r.body.data.find((x: { id: string }) => x.id === near.branchId);
      expect(marker).toMatchObject({ latitude: at(1).latitude, longitude: LNG, club: { id: near.clubId } });
      const half = await h.http.get(api('/discovery/map')).query({ bbox: bbox(LNG - 0.01, LAT, LNG + 0.01, LAT + 2 * KM) }).expect(200);
      expect(ours(ids(half))).toEqual([near.branchId]);
      const empty = await h.http.get(api('/branches/map')).query({ bbox: bbox(LNG + 0.5, LAT + 0.5, LNG + 0.6, LAT + 0.6) }).expect(200);
      expect(ours(ids(empty))).toEqual([]);
    });

    it('validates bbox', async () => {
      for (const q of [
        {},
        { bbox: 'abc' },
        { bbox: '1,2,3' },
        { bbox: '69.1,41.2,69.4,41.4,1' },
        { bbox: '69.4,41.2,69.1,41.4' }, // w > e
        { bbox: '69.1,41.4,69.4,41.2' }, // s > n
        { bbox: '69.1,-95,69.4,41.2' },
        { bbox: '-190,41.2,69.4,41.4' },
        { bbox: '69.1,41.2,69.4,41.4', zoom: 30 },
      ]) {
        const r = await h.http.get(api('/branches/map')).query(q);
        expect({ q, status: r.status }).toEqual({ q, status: 422 });
      }
    });
  });

  describe('summary', () => {
    it('returns card with distance for active branch', async () => {
      const r = await h.http.get(api(`/branches/${near.branchId}/summary`)).query({ lat: LAT, lng: LNG }).expect(200);
      expect(r.body.data).toMatchObject({ id: near.branchId, min_price_per_hour: 1_000_000, total_devices: 2, is_open_now: true });
      expect(Math.abs(r.body.data.distance_m - 1000)).toBeLessThan(15);
      const noPoint = await h.http.get(api(`/discovery/branches/${far.branchId}/summary`)).expect(200);
      expect(noPoint.body.data.distance_m).toBeNull();
    });

    it('404 for inactive branch / non-active clubs; bad input rejected', async () => {
      for (const id of [suspended.branchId, draft.branchId, closed.branchId, inactiveBranch, '00000000-0000-4000-8000-000000000000']) {
        await h.http.get(api(`/branches/${id}/summary`)).expect(404);
      }
      const bad = await h.http.get(api('/branches/not-a-uuid/summary'));
      expect([400, 422]).toContain(bad.status);
      await h.http.get(api(`/branches/${near.branchId}/summary`)).query({ lat: 'abc', lng: LNG }).expect(422);
      await h.http.get(api(`/branches/${near.branchId}/summary`)).query({ lat: 95, lng: LNG }).expect(422);
    });
  });
});
