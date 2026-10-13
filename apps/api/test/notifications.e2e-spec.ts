import { PrismaService } from '../src/database/prisma.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { api, bearer, Harness, TestClub } from './utils/harness';
import { completedBooking, newClub, newCustomer } from './utils/flows';

/**
 * Bildirishnomalar (docs/01-API.md §6.15): ro'yxat (cursor), o'qilmaganlar soni, o'qish, hammasini o'qish,
 * sozlamalar, push tokenlar; klub e'lonlari va platforma broadcast'lari (scope + audit).
 */
describe('Notifications & announcements (e2e)', () => {
  const h = new Harness();
  let A: TestClub;
  let B: TestClub;
  let alice: { token: string; phone: string; id: string };
  let bob: { token: string; phone: string; id: string };
  let notif: NotificationsService;
  let prisma: PrismaService;

  const me = async (token: string) => (await h.http.get(api('/auth/me')).set(bearer(token)).expect(200)).body.data.id as string;
  const unread = async (token: string) => (await h.http.get(api('/notifications/unread-count')).set(bearer(token)).expect(200)).body.data.count as number;

  beforeAll(async () => {
    await h.start();
    notif = h.get(NotificationsService);
    prisma = h.get(PrismaService);
    [A, B] = [await newClub(h), await newClub(h)];
    const a = await newCustomer(h);
    const b = await newCustomer(h);
    alice = { ...a, id: await me(a.token) };
    bob = { ...b, id: await me(b.token) };
    // Alice — A klub mijozi, Bob — B klub mijozi (klub e'lonlari auditoriyasi)
    await completedBooking(h, A, alice.phone);
    await completedBooking(h, B, bob.phone);
  }, 120_000);

  afterAll(() => h.stop());

  describe('inbox', () => {
    let ids: string[] = [];

    beforeAll(async () => {
      await h.http.post(api('/notifications/read-all')).set(bearer(alice.token)).expect(201);
      for (let i = 0; i < 5; i++) await notif.notify([alice.id], 'REVIEW_REPLY', { club: `Klub ${i}`, reply: `Javob ${i}` }, { n: i });
      const all = await h.http.get(api('/notifications?limit=100')).set(bearer(alice.token)).expect(200);
      ids = all.body.data.filter((x: { type: string; read_at: string | null }) => x.type === 'REVIEW_REPLY' && !x.read_at).map((x: { id: string }) => x.id);
    });

    it('list is newest-first with cursor pagination', async () => {
      expect(ids).toHaveLength(5);
      const p1 = await h.http.get(api('/notifications?limit=2')).set(bearer(alice.token)).expect(200);
      expect(p1.body.data).toHaveLength(2);
      expect(p1.body.meta.next_cursor).toBe(p1.body.data[1].id);
      expect(p1.body.data[0].id > p1.body.data[1].id).toBe(true);
      expect(p1.body.data[0]).toMatchObject({ user_id: alice.id, title: expect.any(String), body: expect.any(String), channels: expect.arrayContaining(['IN_APP']) });
      const p2 = await h.http.get(api(`/notifications?limit=2&cursor=${p1.body.meta.next_cursor}`)).set(bearer(alice.token)).expect(200);
      expect(p2.body.data).toHaveLength(2);
      expect(p2.body.data[0].id < p1.body.data[1].id).toBe(true);
      const bad = await h.http.get(api('/notifications?limit=101')).set(bearer(alice.token)).expect(422);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
      await h.http.get(api('/notifications')).expect(401);
    });

    it('users see only their own notifications', async () => {
      const list = await h.http.get(api('/notifications?limit=100')).set(bearer(bob.token)).expect(200);
      expect(list.body.data.every((x: { user_id: string }) => x.user_id === bob.id)).toBe(true);
      expect(list.body.data.map((x: { id: string }) => x.id)).not.toEqual(expect.arrayContaining([ids[0]]));
    });

    it('unread count; mark one read (own only); read-all', async () => {
      expect(await unread(alice.token)).toBe(5);
      // Bob Alice'ning bildirishnomasini o'qilgan qila olmaydi
      await h.http.patch(api(`/notifications/${ids[0]}/read`)).set(bearer(bob.token)).expect(200);
      expect(await unread(alice.token)).toBe(5);

      await h.http.patch(api(`/notifications/${ids[0]}/read`)).set(bearer(alice.token)).expect(200);
      expect(await unread(alice.token)).toBe(4);
      // Takror o'qish — o'zgarmaydi
      await h.http.patch(api(`/notifications/${ids[0]}/read`)).set(bearer(alice.token)).expect(200);
      expect(await unread(alice.token)).toBe(4);
      const one = (await prisma.notifications.findUniqueOrThrow({ where: { id: ids[0] } })).read_at;
      expect(one).toBeTruthy();

      const bobBefore = await unread(bob.token);
      const all = await h.http.post(api('/notifications/read-all')).set(bearer(alice.token)).expect(201);
      expect(all.body.data.updated).toBe(4);
      expect(await unread(alice.token)).toBe(0);
      expect(await unread(bob.token)).toBe(bobBefore);
    });

    it('dedupe_key prevents duplicate notifications', async () => {
      const key = `e2e-dedupe-${Date.now()}`;
      await notif.notify([alice.id], 'REVIEW_REPLY', { club: 'X', reply: 'Y' }, {}, { dedupe_key: key });
      await notif.notify([alice.id], 'REVIEW_REPLY', { club: 'X', reply: 'Y' }, {}, { dedupe_key: key });
      expect(await prisma.notifications.count({ where: { user_id: alice.id, dedupe_key: key } })).toBe(1);
    });
  });

  describe('preferences & device tokens', () => {
    it('preferences default to on, can be patched, validated', async () => {
      const def = await h.http.get(api('/users/me/notification-preferences')).set(bearer(bob.token)).expect(200);
      expect(def.body.data).toEqual({ telegram: true, push: true, reminders: true, announcements: true, telegram_linked: false });
      const p = await h.http.patch(api('/users/me/notification-preferences')).set(bearer(bob.token)).send({ reminders: false }).expect(200);
      expect(p.body.data).toMatchObject({ reminders: false, announcements: true, push: true });
      const again = await h.http.get(api('/users/me/notification-preferences')).set(bearer(bob.token)).expect(200);
      expect(again.body.data.reminders).toBe(false);
      await h.http.patch(api('/users/me/notification-preferences')).set(bearer(bob.token)).send({ reminders: 'no' }).expect(422);
      await h.http.patch(api('/users/me/notification-preferences')).set(bearer(bob.token)).send({ hacker: true }).expect(422);
      // Boshqa foydalanuvchiga ta'sir qilmaydi
      expect((await h.http.get(api('/users/me/notification-preferences')).set(bearer(alice.token)).expect(200)).body.data.reminders).toBe(true);
    });

    it('reminders off → reminder-type notifications are skipped, transactional ones still delivered', async () => {
      const before = await prisma.notifications.count({ where: { user_id: bob.id } });
      await notif.notify([bob.id], 'BOOKING_REMINDER', { code: 'X', when: 'soon', minutes: 15, branch: 'B' });
      expect(await prisma.notifications.count({ where: { user_id: bob.id } })).toBe(before);
      await notif.notify([bob.id], 'REVIEW_REPLY', { club: 'B', reply: 'ok' });
      expect(await prisma.notifications.count({ where: { user_id: bob.id } })).toBe(before + 1);
      await h.http.patch(api('/users/me/notification-preferences')).set(bearer(bob.token)).send({ reminders: true }).expect(200);
    });

    it('device tokens: register (upsert), validated, removable only by owner', async () => {
      const token = `fcm-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await h.http.post(api('/users/me/device-tokens')).set(bearer(alice.token)).send({ token, platform: 'android', app_version: '1.0.0' }).expect(201);
      await h.http.post(api('/users/me/device-tokens')).set(bearer(alice.token)).send({ token, platform: 'android', app_version: '1.0.1' }).expect(201);
      const rows = await prisma.device_tokens.findMany({ where: { token } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: alice.id, app_version: '1.0.1' });

      await h.http.post(api('/users/me/device-tokens')).set(bearer(alice.token)).send({ token: 'short', platform: 'android' }).expect(422);
      await h.http.post(api('/users/me/device-tokens')).set(bearer(alice.token)).send({ token: `${token}-x`, platform: 'symbian' }).expect(422);

      // Bob o'chira olmaydi
      await h.http.delete(api(`/users/me/device-tokens/${encodeURIComponent(token)}`)).set(bearer(bob.token)).expect(200);
      expect(await prisma.device_tokens.count({ where: { token } })).toBe(1);
      await h.http.delete(api(`/users/me/device-tokens/${encodeURIComponent(token)}`)).set(bearer(alice.token)).expect(200);
      expect(await prisma.device_tokens.count({ where: { token } })).toBe(0);
    });
  });

  describe('club announcements', () => {
    let annId: string;

    it('only club staff with announcements.manage of that club can post', async () => {
      const body = { title: 'Aksiya', body: 'Bugun 20% chegirma' };
      await h.http.post(api(`/clubs/${A.clubId}/announcements`)).set(bearer(B.owner)).send(body).expect(403);
      await h.http.post(api(`/clubs/${A.clubId}/announcements`)).set(bearer(alice.token)).send(body).expect(403);
      const op = await h.staff(A, 'OPERATOR', A.branchId);
      await h.http.post(api(`/clubs/${A.clubId}/announcements`)).set(bearer(op.token)).send(body).expect(403);
      await h.http.post(api(`/clubs/${A.clubId}/announcements`)).set(bearer(A.owner)).send({ title: 'x', body: 'y' }).expect(422);
      await h.http.post(api(`/clubs/${A.clubId}/announcements`)).set(bearer(A.owner)).send({ ...body, audience: 'EVERYONE' }).expect(422);
    });

    it('notify=true reaches only this club\'s customers (respecting announcement prefs); audited', async () => {
      const carol = await newCustomer(h);
      const carolId = await me(carol.token);
      await completedBooking(h, A, carol.phone, 1);
      await h.http.patch(api('/users/me/notification-preferences')).set(bearer(carol.token)).send({ announcements: false }).expect(200);

      const title = `E'lon ${Date.now()}`;
      const r = await h.http.post(api(`/clubs/${A.clubId}/announcements`)).set(bearer(A.owner)).send({ title, body: 'Yangi PS5 keldi', notify: true }).expect(201);
      annId = r.body.data.id;
      expect(r.body.data).toMatchObject({ club_id: A.clubId, title, audience: 'ALL' });
      expect(r.body.data.recipients).toBe(2); // alice + carol (bob — boshqa klub mijozi)

      const has = async (uid: string) => prisma.notifications.count({ where: { user_id: uid, type: 'ANNOUNCEMENT', data: { path: ['announcement_id'], equals: annId } } });
      expect(await has(alice.id)).toBe(1);
      expect(await has(bob.id)).toBe(0);
      expect(await has(carolId)).toBe(0); // e'lonlar o'chirilgan

      const audit = await prisma.audit_logs.findFirst({ where: { action: 'club.announcement', target_id: annId } });
      expect(audit?.club_id).toBe(A.clubId);
    });

    it('public list is per club; expired announcements hidden', async () => {
      await h.http.post(api(`/clubs/${A.clubId}/announcements`)).set(bearer(A.owner)).send({ title: 'Eski', body: 'Tugagan aksiya', ends_at: new Date(Date.now() - 60_000).toISOString() }).expect(201);
      const listA = await h.http.get(api(`/clubs/${A.clubId}/announcements`)).expect(200);
      expect(listA.body.data.map((x: { id: string }) => x.id)).toContain(annId);
      expect(listA.body.data.every((x: { club_id: string }) => x.club_id === A.clubId)).toBe(true);
      expect(listA.body.data.map((x: { title: string }) => x.title)).not.toContain('Eski');
      const listB = await h.http.get(api(`/clubs/${B.clubId}/announcements`)).expect(200);
      expect(listB.body.data.map((x: { id: string }) => x.id)).not.toContain(annId);
      // Platforma e'lonlari ro'yxatida klub e'loni yo'q
      const platform = await h.http.get(api('/announcements')).expect(200);
      expect(platform.body.data.map((x: { id: string }) => x.id)).not.toContain(annId);
    });

    it('club B cannot delete club A announcement (even via its own clubId route)', async () => {
      await h.http.delete(api(`/clubs/${A.clubId}/announcements/${annId}`)).set(bearer(B.owner)).expect(403);
      await h.http.delete(api(`/clubs/${B.clubId}/announcements/${annId}`)).set(bearer(B.owner)).expect(404);
      expect(await prisma.announcements.count({ where: { id: annId } })).toBe(1);
      await h.http.delete(api(`/clubs/${A.clubId}/announcements/${annId}`)).set(bearer(A.owner)).expect(200);
      expect(await prisma.announcements.count({ where: { id: annId } })).toBe(0);
    });
  });

  describe('platform broadcasts', () => {
    let id: string;

    afterAll(async () => {
      if (id) await prisma.announcements.deleteMany({ where: { id } });
    });

    it('only platform.announcements.manage can broadcast', async () => {
      const body = { title: 'Platforma', body: 'Texnik ishlar' };
      await h.http.post(api('/admin/broadcasts')).set(bearer(A.owner)).send(body).expect(403);
      await h.http.post(api('/admin/broadcasts')).set(bearer(alice.token)).send(body).expect(403);
      const r = await h.http.post(api('/admin/broadcasts')).set(bearer(h.admin)).send({ ...body, title: `Platforma ${Date.now()}`, ends_at: new Date(Date.now() + 3600_000).toISOString() }).expect(201);
      id = r.body.data.id;
      expect(r.body.data.club_id).toBeNull();
      const list = await h.http.get(api('/announcements')).expect(200);
      expect(list.body.data.map((x: { id: string }) => x.id)).toContain(id);
      // Klub e'lonlari ro'yxatiga tushmaydi
      expect((await h.http.get(api(`/clubs/${A.clubId}/announcements`)).expect(200)).body.data.map((x: { id: string }) => x.id)).not.toContain(id);
    });

    it('club owner cannot delete a broadcast; admin can', async () => {
      await h.http.delete(api(`/admin/broadcasts/${id}`)).set(bearer(A.owner)).expect(403);
      await h.http.delete(api(`/clubs/${A.clubId}/announcements/${id}`)).set(bearer(A.owner)).expect(404);
      expect(await prisma.announcements.count({ where: { id } })).toBe(1);
      await h.http.delete(api(`/admin/broadcasts/${id}`)).set(bearer(h.admin)).expect(200);
      expect(await prisma.announcements.count({ where: { id } })).toBe(0);
    });
  });
});
