import './utils/storage-tmp.env';
import { PrismaService } from '../src/database/prisma.service';
import { FilesService } from '../src/modules/files/files.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';

/**
 * O'z fayl saqlash joyimiz + o'tkazmada to'lov havolasi va chek (docs/01-API.md §6.10, §6.19):
 * yuklash (tur baytlar bo'yicha), imzolangan havola, egasi/xodim/boshqa klub ruxsatlari, LINK kanali, chek majburiyligi, chekni qayta ishlatib bo'lmasligi.
 */
describe('Files, payment link & receipts (e2e)', () => {
  const h = new Harness();
  let prisma: PrismaService;
  let A: TestClub;
  let B: TestClub;
  const PRICE = 1_200_000;
  let minutes = 120;

  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b30000000049454e44ae426082', 'hex');
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const upload = (token: string, buf: Buffer, purpose = 'RECEIPT', name = 'chek.png', clubId?: string) => {
    const req = h.http.post(api('/files')).set(bearer(token)).field('purpose', purpose).attach('file', buf, name);
    return clubId ? req.field('club_id', clubId) : req;
  };
  const book = async (c: TestClub, token: string, idx = 0) =>
    (await h.http.post(api('/bookings')).set(bearer(token)).send({ branch_id: c.branchId, start_at: slot((minutes += 90)), duration_minutes: 60, items: [{ device_id: c.devices[idx % c.devices.length] }] }).expect(201)).body.data as { id: string; code: string };
  const settings = (c: TestClub, body: Record<string, unknown>) => h.http.patch(api(`/clubs/${c.clubId}/settings`)).set(bearer(c.owner)).send(body);
  const transfer = (token: string, body: Record<string, unknown>) => h.http.post(api('/payments/transfer')).set(bearer(token)).send(body);
  const rawPath = (url: string) => url.replace(/^\/api\/v1/, '');

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    [A, B] = [await h.club({ pricePerHour: PRICE, devices: 3 }), await h.club({ pricePerHour: PRICE })];
  }, 120_000);

  afterAll(async () => {
    await h.stop();
  });

  describe('files', () => {
    it('upload checks real bytes, not the extension/content-type; size and purpose rules', async () => {
      const c = await h.customer();
      const ok = await upload(c.token, PNG).expect(201);
      expect(ok.body.data).toMatchObject({ purpose: 'RECEIPT', mime: 'image/png', size: PNG.length });
      expect(ok.body.data.url).toMatch(/^\/api\/v1\/files\/[0-9a-f-]+\/raw\?exp=\d+&sig=/);
      expect((await upload(c.token, PDF, 'RECEIPT', 'chek.pdf').expect(201)).body.data.mime).toBe('application/pdf');
      // HTML "rasm" nomi bilan — rad etiladi
      const fake = await upload(c.token, Buffer.from('<html><script>alert(1)</script></html>'), 'RECEIPT', 'x.png').expect(422);
      expect(fake.body.error.details).toMatchObject({ reason: 'FILE_TYPE' });
      await h.http.post(api('/files')).set(bearer(c.token)).field('purpose', 'RECEIPT').expect(422);
      await upload(c.token, PNG, 'NOPE').expect(422);
      // Klub logosi: faqat shu klub xodimi (clubs.update)
      await upload(c.token, PNG, 'CLUB_MEDIA', 'logo.png', A.clubId).expect(404);
      await upload(B.owner, PNG, 'CLUB_MEDIA', 'logo.png', A.clubId).expect(404);
      const logo = await upload(A.owner, PNG, 'CLUB_MEDIA', 'logo.png', A.clubId).expect(201);
      expect(logo.body.data.url).toBe(`/api/v1/files/${logo.body.data.id}/raw`);
      // Ommaviy fayl — tokensiz ochiladi
      const pub = await h.http.get(api(`/files/${logo.body.data.id}/raw`)).expect(200);
      expect(pub.headers['content-type']).toBe('image/png');
      expect(pub.headers['x-content-type-options']).toBe('nosniff');
    });

    it('private file: signed URL works, tampered/expired/unsigned does not; only owner gets meta before it is attached', async () => {
      const c = await h.customer();
      const other = await h.customer();
      const f = (await upload(c.token, PNG).expect(201)).body.data;
      const res = await h.http.get(api(rawPath(f.url))).expect(200);
      expect(Buffer.from(res.body).equals(PNG)).toBe(true);
      await h.http.get(api(`/files/${f.id}/raw`)).expect(404);
      await h.http.get(api(rawPath(f.url).replace(/sig=.{4}/, 'sig=AAAA'))).expect(404);
      const svc = h.get<FilesService>(FilesService);
      const old = svc.url({ id: f.id, purpose: 'RECEIPT' }, Date.now() - 3600_000);
      await h.http.get(api(rawPath(old))).expect(404);
      await h.http.get(api(`/files/${f.id}`)).set(bearer(c.token)).expect(200);
      await h.http.get(api(`/files/${f.id}`)).set(bearer(other.token)).expect(404);
      await h.http.get(api(`/files/${f.id}`)).set(bearer(A.owner)).expect(404);
    });

    it('club documents upload to our storage: private, signed, only for the club and platform; file cannot be reused or taken by another club', async () => {
      const f = (await upload(A.owner, PDF, 'CLUB_DOCUMENT', 'litsenziya.pdf', A.clubId).expect(201)).body.data;
      expect(f.public_url).toBeNull();
      // Boshqa klub shu faylni o'z hujjatiga biriktira olmaydi
      await h.http.post(api(`/clubs/${B.clubId}/documents`)).set(bearer(B.owner)).send({ type: 'LICENSE', file_id: f.id }).expect(422);
      await h.http.post(api(`/clubs/${A.clubId}/documents`)).set(bearer(A.owner)).send({ type: 'LICENSE' }).expect(422);
      const doc = (await h.http.post(api(`/clubs/${A.clubId}/documents`)).set(bearer(A.owner)).send({ type: 'LICENSE', file_id: f.id }).expect(201)).body.data;
      expect(doc).toMatchObject({ file_id: f.id });
      expect(doc.file_url).toMatch(/sig=/);
      await h.http.post(api(`/clubs/${A.clubId}/documents`)).set(bearer(A.owner)).send({ type: 'OTHER', file_id: f.id }).expect(422);
      // Klub ro'yxati va platforma (moderatsiya) — ochiladigan havola
      const list = (await h.http.get(api(`/clubs/${A.clubId}/documents`)).set(bearer(A.owner)).expect(200)).body.data as { id: string; file_url: string }[];
      await h.http.get(api(rawPath(list.find((d) => d.id === doc.id)!.file_url))).expect(200);
      const adm = (await h.http.get(api(`/admin/clubs/${A.clubId}`)).set(bearer(h.admin)).expect(200)).body.data;
      expect(adm.documents.find((d: { id: string }) => d.id === doc.id).file_url).toMatch(/sig=/);
      await h.http.get(api(`/files/${f.id}`)).set(bearer(h.admin)).expect(200);
      await h.http.get(api(`/files/${f.id}`)).set(bearer(B.owner)).expect(404);
    });

    it('club logo: CLUB_MEDIA returns an absolute public_url that can be saved as logo_url', async () => {
      const f = (await upload(A.owner, PNG, 'CLUB_MEDIA', 'logo.png', A.clubId).expect(201)).body.data;
      expect(f.public_url).toMatch(new RegExp(`^https?://.+/files/${f.id}/raw$`));
      await h.http.patch(api(`/clubs/${A.clubId}`)).set(bearer(A.owner)).send({ logo_url: f.public_url }).expect(200);
      const pub = (await h.http.get(api(`/branches/${A.branchId}`)).expect(200)).body.data;
      expect(pub.club.logo_url).toBe(f.public_url);
    });

    it('orphan receipts are purged after 24h', async () => {
      const c = await h.customer();
      const f = (await upload(c.token, PNG).expect(201)).body.data;
      await prisma.files.update({ where: { id: f.id }, data: { created_at: new Date(Date.now() - 25 * 3600_000) } });
      await h.get<FilesService>(FilesService).purgeOrphans();
      expect(await prisma.files.findUnique({ where: { id: f.id } })).toBeNull();
      await h.http.get(api(rawPath(f.url))).expect(404);
    });
  });

  describe('payment link & receipt', () => {
    it('club sets a payment link (https only) next to the card; customers see both; link-only club works without a card', async () => {
      await settings(A, { transfer_link: { url: 'http://pay.example.uz/x', label: 'Click' } }).expect(422);
      await settings(A, { transfer_link: { url: 'javascript:alert(1)' } }).expect(422);
      const s = await settings(A, { transfer_card: { number: '8600123412341234', holder: 'Ali Valiyev' }, transfer_link: { url: 'https://my.click.uz/pay/abc', label: 'Click' } }).expect(200);
      expect(s.body.data).toMatchObject({ transfer_link: { url: 'https://my.click.uz/pay/abc', label: 'Click' }, transfer_receipt_required: false });

      const c = await h.customer();
      const b = await book(A, c.token);
      const d = (await h.http.get(api(`/bookings/${b.id}`)).set(bearer(c.token)).expect(200)).body.data;
      expect(d.transfer).toMatchObject({ card_number: '8600123412341234', link: { url: 'https://my.click.uz/pay/abc', label: 'Click' }, receipt_required: false, amount: PRICE });

      // Faqat havola (karta yo'q) — B klub
      await settings(B, { transfer_link: { url: 'https://payme.uz/fallback/xyz', label: 'Payme' } }).expect(200);
      const cb = await h.customer();
      const bb = await book(B, cb.token);
      const db = (await h.http.get(api(`/bookings/${bb.id}`)).set(bearer(cb.token)).expect(200)).body.data;
      expect(db.transfer).toMatchObject({ card_number: null, link: { label: 'Payme' } });
      const branch = (await h.http.get(api(`/branches/${B.branchId}`)).expect(200)).body.data;
      expect(branch.payment_options.card_transfer).toBe(true);
      // Kanal ko'rsatilmasa — havola; CARD so'ralsa — o'chiq
      const bad = await transfer(cb.token, { booking_id: bb.id, channel: 'CARD', payer_card_last4: '1111' }).expect(402);
      expect(bad.body.error.details).toMatchObject({ reason: 'TRANSFER_CHANNEL_DISABLED' });
      const p = (await transfer(cb.token, { booking_id: bb.id }).expect(201)).body.data;
      expect(p.provider_payload).toMatchObject({ channel: 'LINK', link_label: 'Payme', payer_card_last4: null });
      expect(p.booking_status).toBe('CONFIRMED');
    });

    it('CARD still needs last 4 digits; LINK does not', async () => {
      const c = await h.customer();
      const b = await book(A, c.token, 1);
      await transfer(c.token, { booking_id: b.id, channel: 'CARD' }).expect(422);
      const p = (await transfer(c.token, { booking_id: b.id, channel: 'LINK' }).expect(201)).body.data;
      expect(p.provider_payload).toMatchObject({ channel: 'LINK', link_label: 'Click' });
    });

    it('receipt: attached once, visible to the customer and the club operator, not to another club; staff list has receipt_url', async () => {
      const c = await h.customer();
      const b = await book(A, c.token, 2);
      const f = (await upload(c.token, PNG).expect(201)).body.data;
      // Boshqa mijozning cheki ishlatilmaydi
      const thief = await h.customer();
      const tb = await book(A, thief.token, 0);
      const stolen = await transfer(thief.token, { booking_id: tb.id, channel: 'LINK', receipt_file_id: f.id }).expect(422);
      expect(stolen.body.error.details).toMatchObject({ reason: 'RECEIPT_INVALID' });

      const p = (await transfer(c.token, { booking_id: b.id, channel: 'CARD', payer_card_last4: '4321', receipt_file_id: f.id }).expect(201)).body.data;
      expect(p.provider_payload.receipt_file_id).toBe(f.id);
      const row = await prisma.files.findUniqueOrThrow({ where: { id: f.id } });
      expect(row).toMatchObject({ ref_type: 'payment', ref_id: p.id, club_id: A.clubId });

      // Mijoz bron sahifasida o'z chekini ko'radi
      const d = (await h.http.get(api(`/bookings/${b.id}`)).set(bearer(c.token)).expect(200)).body.data;
      expect(d.transfer.pending.receipt_url).toMatch(/sig=/);
      await h.http.get(api(rawPath(d.transfer.pending.receipt_url))).expect(200);

      // Operator: o'tkazmalar ro'yxatida chek havolasi; meta ham ochiladi
      const op = await h.staff(A, 'OPERATOR', A.branchId);
      const list = (await h.http.get(api(`/payments?method=CARD_TRANSFER&status=PROCESSING&branch_id=${A.branchId}&limit=50`)).set(bearer(op.token)).expect(200)).body.data as { id: string; receipt_url: string | null }[];
      const mine = list.find((x) => x.id === p.id)!;
      expect(mine.receipt_url).toMatch(/sig=/);
      await h.http.get(api(rawPath(mine.receipt_url!))).expect(200);
      await h.http.get(api(`/files/${f.id}`)).set(bearer(op.token)).expect(200);
      // Boshqa klub va boshqa mijoz — yo'q
      await h.http.get(api(`/files/${f.id}`)).set(bearer(B.owner)).expect(404);
      await h.http.get(api(`/files/${f.id}`)).set(bearer(thief.token)).expect(404);

      // Bir chek ikkinchi marta ishlatilmaydi (rad etilgandan keyin qayta yuborish — yangi chek kerak)
      await h.http.post(api(`/payments/${p.id}/transfer/reject`)).set(bearer(op.token)).send({ reason: 'Chek mos emas' }).expect(201);
      const again = await transfer(c.token, { booking_id: b.id, channel: 'LINK', receipt_file_id: f.id }).expect(422);
      expect(again.body.error.details).toMatchObject({ reason: 'RECEIPT_INVALID' });
    });

    it('club can require a receipt', async () => {
      await settings(A, { transfer_receipt_required: true }).expect(200);
      const c = await h.customer();
      const b = await book(A, c.token, 1);
      const d = (await h.http.get(api(`/bookings/${b.id}`)).set(bearer(c.token)).expect(200)).body.data;
      expect(d.transfer.receipt_required).toBe(true);
      const r = await transfer(c.token, { booking_id: b.id, channel: 'LINK' }).expect(422);
      expect(r.body.error.details).toMatchObject({ field: 'receipt_file_id', reason: 'RECEIPT_REQUIRED' });
      const f = (await upload(c.token, PDF, 'RECEIPT', 'chek.pdf').expect(201)).body.data;
      await transfer(c.token, { booking_id: b.id, channel: 'LINK', receipt_file_id: f.id }).expect(201);
      // Sozlamani o'chirish va havolani olib tashlash
      const s = await settings(A, { transfer_receipt_required: false, transfer_link: null }).expect(200);
      expect(s.body.data).toMatchObject({ transfer_link: null, transfer_receipt_required: false });
    });
  });
});
