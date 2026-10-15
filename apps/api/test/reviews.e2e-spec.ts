import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';
import { completedBooking, newClub, newCustomer } from './utils/flows';

/**
 * Sharhlar (docs/01-API.md §6.13) va sevimlilar (§6.14):
 * faqat COMPLETED bron, bron boshiga bitta, egasi 24 soat ichida tahrirlaydi, klub javob beradi (tahrirlay olmaydi),
 * shikoyat → moderatsiya navbati, platforma moderatsiyasi, reyting agregatlari, klub scope.
 */
describe('Reviews & favorites (e2e)', () => {
  const h = new Harness();
  let A: TestClub;
  let B: TestClub;
  let alice: { token: string; phone: string };
  let bob: { token: string; phone: string };
  let aliceBooking: string;
  let bobBooking: string;
  let reviewId: string;

  const publicReviews = async (branchId: string) => (await h.http.get(api(`/branches/${branchId}/reviews`)).expect(200)).body;
  const branchRating = async (branchId: string) => (await h.http.get(api(`/branches/${branchId}`)).expect(200)).body.data;

  beforeAll(async () => {
    await h.start();
    [A, B] = [await newClub(h), await newClub(h)];
    alice = await newCustomer(h);
    bob = await newCustomer(h);
    aliceBooking = (await completedBooking(h, A, alice.phone, 0)).bookingId;
    bobBooking = (await completedBooking(h, A, bob.phone, 1)).bookingId;
  }, 120_000);

  afterAll(() => h.stop());

  it('only a COMPLETED booking can be reviewed', async () => {
    const b = await h.http
      .post(api('/bookings'))
      .set(bearer(alice.token))
      .send({ branch_id: A.branchId, start_at: slot(180), duration_minutes: 60, items: [{ device_id: A.devices[2] }] })
      .expect(201);
    expect(b.body.data.status).not.toBe('COMPLETED');
    const r = await h.http.post(api('/reviews')).set(bearer(alice.token)).send({ booking_id: b.body.data.id, rating: 5 }).expect(409);
    expect(r.body.error.code).toBe('CONFLICT');
  });

  it("cannot review someone else's booking (404) and validates rating 1..5", async () => {
    await h.http.post(api('/reviews')).set(bearer(bob.token)).send({ booking_id: aliceBooking, rating: 4 }).expect(404);
    const bad = await h.http.post(api('/reviews')).set(bearer(alice.token)).send({ booking_id: aliceBooking, rating: 6 }).expect(422);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    await h.http.post(api('/reviews')).set(bearer(alice.token)).send({ booking_id: aliceBooking, rating: 0 }).expect(422);
    await h.http.post(api('/reviews')).send({ booking_id: aliceBooking, rating: 4 }).expect(401);
  });

  it('creates a review: spam filter strips links/phones/html; aggregates updated', async () => {
    const r = await h.http
      .post(api('/reviews'))
      .set(bearer(alice.token))
      .send({ booking_id: aliceBooking, rating: 5, text: 'Zo\'r <b>klub</b>! https://spam.example.com qo\'ng\'iroq +998 90 123 45 67' })
      .expect(201);
    reviewId = r.body.data.id;
    expect(r.body.data).toMatchObject({ rating: 5, status: 'VISIBLE', club_id: A.clubId, branch_id: A.branchId, booking_id: aliceBooking });
    expect(r.body.data.text).not.toContain('<b>');
    expect(r.body.data.text).not.toContain('spam.example.com');
    expect(r.body.data.text).not.toContain('123 45 67');
    expect(r.body.data.text).toContain('[link]');
    expect(r.body.data.text).toContain('[phone]');

    const pub = await publicReviews(A.branchId);
    expect(pub.meta.total).toBe(1);
    expect(pub.meta.distribution).toEqual({ 5: 1 });
    expect(pub.data[0]).not.toHaveProperty('phone');
    const br = await branchRating(A.branchId);
    expect(Number(br.rating_avg)).toBe(5);
    expect(br.rating_count).toBe(1);
  });

  it('one review per booking', async () => {
    const r = await h.http.post(api('/reviews')).set(bearer(alice.token)).send({ booking_id: aliceBooking, rating: 3 }).expect(409);
    expect(r.body.error.code).toBe('CONFLICT');
  });

  it("customer B cannot edit or delete customer A's review", async () => {
    await h.http.patch(api(`/reviews/${reviewId}`)).set(bearer(bob.token)).send({ rating: 1 }).expect(404);
    await h.http.delete(api(`/reviews/${reviewId}`)).set(bearer(bob.token)).expect(404);
    const pub = await publicReviews(A.branchId);
    expect(pub.data[0].rating).toBe(5);
  });

  it('owner edits within 24h (aggregates recalculated), not after 24h', async () => {
    const u = await h.http.patch(api(`/reviews/${reviewId}`)).set(bearer(alice.token)).send({ rating: 4 }).expect(200);
    expect(u.body.data.rating).toBe(4);
    expect(Number((await branchRating(A.branchId)).rating_avg)).toBe(4);

    const mine = await h.http.get(api('/reviews/mine')).set(bearer(alice.token)).expect(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ id: reviewId, can_edit: true, club_name: expect.any(String) });

    // 25 soat oldin yozilgan sharh — tahrirlanmaydi
    const prisma = h.get<PrismaService>(PrismaService);
    const bobReview = await h.http.post(api('/reviews')).set(bearer(bob.token)).send({ booking_id: bobBooking, rating: 2, text: 'Sekin' }).expect(201);
    await prisma.reviews.update({ where: { id: bobReview.body.data.id }, data: { created_at: new Date(Date.now() - 25 * 3600_000) } });
    await h.http.patch(api(`/reviews/${bobReview.body.data.id}`)).set(bearer(bob.token)).send({ rating: 5 }).expect(409);
    const bobMine = await h.http.get(api('/reviews/mine')).set(bearer(bob.token)).expect(200);
    expect(bobMine.body.data[0].can_edit).toBe(false);

    const agg = await branchRating(A.branchId);
    expect(agg.rating_count).toBe(2);
    expect(Number(agg.rating_avg)).toBe(3);
  });

  it('club staff list: own club only; club B and operator cannot read club A reviews', async () => {
    const own = await h.http.get(api(`/clubs/${A.clubId}/reviews`)).set(bearer(A.owner)).expect(200);
    expect(own.body.meta.total).toBe(2);
    expect(own.body.data.every((r: { club_id: string }) => r.club_id === A.clubId)).toBe(true);
    const unanswered = await h.http.get(api(`/clubs/${A.clubId}/reviews?unanswered=true`)).set(bearer(A.owner)).expect(200);
    expect(unanswered.body.meta.total).toBe(2);

    const cross = await h.http.get(api(`/clubs/${A.clubId}/reviews`)).set(bearer(B.owner)).expect(403);
    expect(cross.body.error.code).toBe('FORBIDDEN');
    // B o'z klubida A filialini filtr qilsa ham A sharhlari chiqmaydi
    const leak = await h.http.get(api(`/clubs/${B.clubId}/reviews?branch_id=${A.branchId}`)).set(bearer(B.owner)).expect(200);
    expect(leak.body.data).toHaveLength(0);

    await h.http.get(api(`/clubs/${A.clubId}/reviews`)).set(bearer(alice.token)).expect(403);
    const op = await h.staff(A, 'OPERATOR', A.branchId);
    await h.http.get(api(`/clubs/${A.clubId}/reviews`)).set(bearer(op.token)).expect(403);
  });

  it('club replies (own club only, cannot edit the review); customer is notified', async () => {
    const cross = await h.http.post(api(`/reviews/${reviewId}/reply`)).set(bearer(B.owner)).send({ text: 'Begona javob' }).expect(404);
    expect(cross.body.error.code).toBe('NOT_FOUND');
    await h.http.post(api(`/reviews/${reviewId}/reply`)).set(bearer(alice.token)).send({ text: 'O\'zimga' }).expect(403);
    await h.http.post(api(`/reviews/${reviewId}/reply`)).set(bearer(A.owner)).send({ text: '' }).expect(422);

    const r = await h.http.post(api(`/reviews/${reviewId}/reply`)).set(bearer(A.owner)).send({ text: 'Rahmat! Kutib qolamiz' }).expect(201);
    expect(r.body.data.reply_text).toBe('Rahmat! Kutib qolamiz');
    expect(r.body.data.replied_at).toBeTruthy();
    expect(r.body.data.rating).toBe(4); // sharh o'zgarmaydi
    // Klub mijoz sharhini PATCH/DELETE qila olmaydi
    await h.http.patch(api(`/reviews/${reviewId}`)).set(bearer(A.owner)).send({ rating: 5 }).expect(404);
    await h.http.delete(api(`/reviews/${reviewId}`)).set(bearer(A.owner)).expect(404);

    const n = await h.http.get(api('/notifications')).set(bearer(alice.token)).expect(200);
    expect(n.body.data.some((x: { type: string }) => x.type === 'REVIEW_REPLY')).toBe(true);
    const unanswered = await h.http.get(api(`/clubs/${A.clubId}/reviews?unanswered=true`)).set(bearer(A.owner)).expect(200);
    expect(unanswered.body.meta.total).toBe(1);
  });

  it('report: not own, deduped per user, 3 reports → PENDING_MODERATION (hidden publicly)', async () => {
    const own = await h.http.post(api(`/reviews/${reviewId}/report`)).set(bearer(alice.token)).expect(409);
    expect(own.body.error.code).toBe('CONFLICT');

    const first = await h.http.post(api(`/reviews/${reviewId}/report`)).set(bearer(bob.token)).expect(201);
    expect(first.body.data).toEqual({ reported: true });
    const dup = await h.http.post(api(`/reviews/${reviewId}/report`)).set(bearer(bob.token)).expect(201);
    expect(dup.body.data.duplicate).toBe(true);

    const prisma = h.get<PrismaService>(PrismaService);
    expect((await prisma.reviews.findUniqueOrThrow({ where: { id: reviewId } })).reported_count).toBe(1);

    const c2 = await newCustomer(h);
    const c3 = await newCustomer(h);
    await h.http.post(api(`/reviews/${reviewId}/report`)).set(bearer(c2.token)).expect(201);
    await h.http.post(api(`/reviews/${reviewId}/report`)).set(bearer(c3.token)).expect(201);
    const after = await prisma.reviews.findUniqueOrThrow({ where: { id: reviewId } });
    expect(after.reported_count).toBe(3);
    expect(after.status).toBe('PENDING_MODERATION');

    const pub = await publicReviews(A.branchId);
    expect(pub.data.map((r: { id: string }) => r.id)).not.toContain(reviewId);
    expect((await branchRating(A.branchId)).rating_count).toBe(1);
  });

  it('customer and club owner cannot moderate; platform admin can (audited)', async () => {
    await h.http.patch(api(`/admin/reviews/${reviewId}`)).set(bearer(alice.token)).send({ status: 'VISIBLE' }).expect(403);
    await h.http.patch(api(`/admin/reviews/${reviewId}`)).set(bearer(A.owner)).send({ status: 'VISIBLE' }).expect(403);
    await h.http.get(api('/admin/reviews')).set(bearer(A.owner)).expect(403);
    await h.http.patch(api(`/admin/reviews/${reviewId}`)).set(bearer(h.admin)).send({ status: 'DELETED' }).expect(422);

    const queue = await h.http.get(api('/admin/reviews?status=PENDING_MODERATION&limit=100')).set(bearer(h.admin)).expect(200);
    const row = queue.body.data.find((r: { id: string }) => r.id === reviewId);
    expect(row).toMatchObject({ club_name: expect.any(String), reported_count: 3 });

    await h.http.patch(api(`/admin/reviews/${reviewId}`)).set(bearer(h.admin)).send({ status: 'HIDDEN', note: 'Spam' }).expect(200);
    expect((await publicReviews(A.branchId)).data.map((r: { id: string }) => r.id)).not.toContain(reviewId);

    const v = await h.http.patch(api(`/admin/reviews/${reviewId}`)).set(bearer(h.admin)).send({ status: 'VISIBLE' }).expect(200);
    expect(v.body.data).toEqual({ id: reviewId, status: 'VISIBLE' });
    expect((await publicReviews(A.branchId)).data.map((r: { id: string }) => r.id)).toContain(reviewId);
    expect((await branchRating(A.branchId)).rating_count).toBe(2);

    const prisma = h.get<PrismaService>(PrismaService);
    const audit = await prisma.audit_logs.findMany({ where: { action: 'admin.review.moderate', target_id: reviewId } });
    expect(audit.length).toBe(2);
  });

  it('owner deletes own review; aggregates recalculated', async () => {
    await h.http.delete(api(`/reviews/${reviewId}`)).set(bearer(alice.token)).expect(200);
    const br = await branchRating(A.branchId);
    expect(br.rating_count).toBe(1);
    expect(Number(br.rating_avg)).toBe(2);
    await h.http.post(api(`/reviews/${reviewId}/report`)).set(bearer(bob.token)).expect(404);
  });

  describe('favorites', () => {
    it('add (idempotent), list, remove; unknown branch 404; per-user', async () => {
      await h.http.put(api(`/favorites/${A.branchId}`)).set(bearer(alice.token)).expect(200);
      await h.http.put(api(`/favorites/${A.branchId}`)).set(bearer(alice.token)).expect(200);
      await h.http.put(api(`/favorites/${B.branchId}`)).set(bearer(alice.token)).expect(200);
      await h.http.put(api('/favorites/00000000-0000-7000-8000-000000000000')).set(bearer(alice.token)).expect(404);
      await h.http.put(api(`/favorites/not-a-uuid`)).set(bearer(alice.token)).expect(400);

      const list = await h.http.get(api('/favorites')).set(bearer(alice.token)).expect(200);
      expect(list.body.data.map((f: { branch_id: string }) => f.branch_id).sort()).toEqual([A.branchId, B.branchId].sort());
      expect(list.body.data[0].branch).toMatchObject({ id: expect.any(String), club: expect.any(Object) });

      expect((await h.http.get(api('/favorites')).set(bearer(bob.token)).expect(200)).body.data).toHaveLength(0);
      // Boshqa foydalanuvchi o'chira olmaydi
      await h.http.delete(api(`/favorites/${A.branchId}`)).set(bearer(bob.token)).expect(200);
      expect((await h.http.get(api('/favorites')).set(bearer(alice.token)).expect(200)).body.data).toHaveLength(2);

      await h.http.delete(api(`/favorites/${A.branchId}`)).set(bearer(alice.token)).expect(200);
      const after = await h.http.get(api('/favorites')).set(bearer(alice.token)).expect(200);
      expect(after.body.data.map((f: { branch_id: string }) => f.branch_id)).toEqual([B.branchId]);
      await h.http.get(api('/favorites')).expect(401);
    });
  });
});
