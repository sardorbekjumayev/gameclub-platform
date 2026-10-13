import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { REDIS } from '../../src/infra/redis/redis.module';

/** e2e testlar uchun umumiy yordamchilar: ilova, login, klub/filial/qurilma tayyorlash va tozalash. */

export const api = (p: string) => `/api/v1${p}`;
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
export const rndPhone = () => `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
const rnd255 = () => Math.floor(Math.random() * 255);
export const uniq = (prefix = 'e2e') => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Mijoz bron qilishi mumkin bo'lgan (30 daq slotga tekislangan) UTC vaqt. */
export const slot = (minutesAhead: number) => {
  const d = new Date(Date.now() + minutesAhead * 60_000);
  d.setUTCMinutes(Math.ceil(d.getUTCMinutes() / 30) * 30, 0, 0);
  return d.toISOString();
};

export type Http = ReturnType<typeof request>;

export interface TestClub {
  owner: string;
  ownerPhone: string;
  clubId: string;
  branchId: string;
  /** Nomi bo'yicha saralangan qurilma id'lari. */
  devices: string[];
  tariffId?: string;
}

export interface ClubOptions {
  name?: string;
  devices?: number;
  deviceType?: string;
  prefix?: string;
  /** tiyin/soat; null — tarif yaratilmaydi. */
  pricePerHour?: number | null;
  branch?: Record<string, unknown>;
  approve?: boolean;
}

export class Harness {
  app!: INestApplication;
  http!: Http;
  admin!: string;
  private clubs: string[] = [];
  private owners: string[] = [];

  async start() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    this.app = moduleRef.createNestApplication();
    configureApp(this.app);
    await this.app.init();
    this.http = request(this.app.getHttpServer());
    await this.resetRateLimits();
    const res = await this.http
      .post(api('/auth/login'))
      .send({ login: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD })
      .expect(200);
    this.admin = res.body.data.access_token;
    return this;
  }

  get redis() {
    return this.app.get<Redis>(REDIS);
  }

  get<T>(token: unknown): T {
    return this.app.get(token as never) as T;
  }

  async resetRateLimits() {
    for (const pattern of ['login:*', 'otp:ip:*']) {
      const keys = await this.redis.keys(pattern);
      if (keys.length) await this.redis.del(...keys);
    }
  }

  async otpLogin(phone = rndPhone()) {
    await this.redis.del(`otp:cooldown:${phone}`);
    // Har login o'z IP'sidan — parallel suite'lar umumiy OTP IP limitiga (10/soat) urilmasin
    const ip = `10.${rnd255()}.${rnd255()}.${rnd255()}`;
    await this.http.post(api('/auth/send-otp')).set('X-Forwarded-For', ip).send({ phone, purpose: 'LOGIN' }).expect(200);
    const res = await this.http.post(api('/auth/verify-otp')).send({ phone, code: '000000' }).expect(200);
    return res.body.data.access_token as string;
  }

  /** Yangi mijoz: token va telefon. */
  async customer() {
    const phone = rndPhone();
    return { token: await this.otpLogin(phone), phone };
  }

  /** ACTIVE klub + filial (24/7) + qurilmalar + tarif. Tozalash `stop()` da avtomatik. */
  async club(opts: ClubOptions = {}): Promise<TestClub> {
    const ownerPhone = rndPhone();
    let owner = await this.otpLogin(ownerPhone);
    const c = await this.http
      .post(api('/clubs'))
      .set(bearer(owner))
      .send({ name: opts.name ?? `E2E ${uniq('club')}`, phone: ownerPhone, owner_password: 'StrongPass#2026' })
      .expect(201);
    const clubId = c.body.data.id as string;
    this.clubs.push(clubId);
    owner = await this.otpLogin(ownerPhone);
    this.owners.push(owner);
    const b = await this.http
      .post(api(`/clubs/${clubId}/branches`))
      .set(bearer(owner))
      .send({
        name: 'Asosiy',
        address: 'Toshkent, Chilonzor 1',
        latitude: 41.28,
        longitude: 69.2,
        working_hours: { always_open: true },
        ...opts.branch,
      })
      .expect(201);
    const branchId = b.body.data.id as string;
    const count = opts.devices ?? 3;
    const type = opts.deviceType ?? 'PC';
    if (count > 0) {
      await this.http
        .post(api(`/branches/${branchId}/devices/bulk`))
        .set(bearer(owner))
        .send({ prefix: opts.prefix ?? `${type}-`, from: 1, to: count, type })
        .expect(201);
    }
    const list = await this.http.get(api(`/branches/${branchId}/devices`)).set(bearer(owner)).expect(200);
    const devices = (list.body.data as { id: string; name: string }[])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => d.id);
    let tariffId: string | undefined;
    if (opts.pricePerHour !== null) {
      const t = await this.http
        .post(api(`/branches/${branchId}/tariffs`))
        .set(bearer(owner))
        .send({ name: 'Standart', price_per_hour: opts.pricePerHour ?? 1_200_000, device_type: type })
        .expect(201);
      tariffId = t.body.data.id;
    }
    if (opts.approve !== false) {
      await this.http.post(api(`/clubs/${clubId}/submit`)).set(bearer(owner)).expect(201);
      await this.http.post(api(`/admin/clubs/${clubId}/approve`)).set(bearer(this.admin)).expect(201);
    }
    return { owner, ownerPhone, clubId, branchId, devices, tariffId };
  }

  /** Klub egasi uchun smena ochadi (naqd to'lovlar uchun kerak). */
  async openShift(token: string, branchId: string, openingCash = 0) {
    const cur = await this.http.get(api('/shifts/current')).set(bearer(token));
    if (cur.body?.data?.id) return cur.body.data.id as string;
    const r = await this.http.post(api('/shifts/open')).set(bearer(token)).send({ branch_id: branchId, opening_cash: openingCash }).expect(201);
    return r.body.data.id as string;
  }

  /** Klub xodimini bevosita qo'shadi va uning tokenini qaytaradi. */
  async staff(club: TestClub, role: string, branchId?: string) {
    const phone = rndPhone();
    const inv = await this.http
      .post(api(`/clubs/${club.clubId}/staff/invitations`))
      .set(bearer(club.owner))
      .send({ phone, role, ...(branchId ? { branch_id: branchId } : {}) })
      .expect(201);
    const acc = await this.http
      .post(api('/auth/invitations/accept'))
      .send({ token: inv.body.data.token, password: 'StaffPass#2026', first_name: role })
      .expect(200);
    return { token: acc.body.data.access_token as string, phone };
  }

  async stop() {
    for (const owner of this.owners) {
      const shift = await this.http.get(api('/shifts/current')).set(bearer(owner));
      if (shift.body?.data?.id) await this.http.post(api(`/shifts/${shift.body.data.id}/close`)).set(bearer(owner)).send({ counted_cash: 0 });
    }
    // Dev bazada test klublari ommaviy katalogda qolmasin
    for (const id of this.clubs) {
      await this.http.post(api(`/admin/clubs/${id}/close`)).set(bearer(this.admin)).send({ reason: 'e2e cleanup' });
    }
    await this.app?.close();
  }
}
