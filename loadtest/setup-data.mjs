#!/usr/bin/env node
/**
 * Yuklama testi uchun ALOHIDA test klubi: klub + filial (24/7) + kategoriya + qurilmalar + tarif, super admin tasdiqlaydi.
 * Natija `loadtest/.data.json` ga yoziladi (git'ga tushmaydi). k6 emas — oddiy Node 18+ (global fetch).
 *
 *   BASE_URL=http://localhost:4700/api/v1 ADMIN_EMAIL=admin@gameclub.local ADMIN_PASSWORD='ChangeMe123!' node loadtest/setup-data.mjs
 *
 * Ixtiyoriy: DEVICES (oddiy PC soni, default 20), CATEGORY_DEVICES (kategoriyadagi PC soni, default 5),
 * OTP_CODE (default 000000), CLOSE=1 — `.data.json` dagi klubni yopish (testdan keyin katalogda qolmasin).
 * Usul `apps/api/test/utils/harness.ts` `club()` bilan bir xil.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:4700/api/v1').replace(/\/+$/, '');
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(BASE_URL + '/');
// Lokal dev'da standart super admin (CLAUDE.md); boshqa muhitda env majburiy
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || (LOCAL ? 'admin@gameclub.local' : '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (LOCAL ? 'ChangeMe123!' : '');
const OTP_CODE = process.env.OTP_CODE || '000000';
const DEVICES = Number(process.env.DEVICES || 20);
const CATEGORY_DEVICES = Number(process.env.CATEGORY_DEVICES || 5);
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.data.json');

const rnd255 = () => randomInt(256);
const randomPhone = () => `+99899${String(randomInt(1e7)).padStart(7, '0')}`;

async function call(method, path, { token, body, headers = {}, expect = [200, 201] } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* JSON emas */
  }
  if (!expect.includes(res.status)) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json?.data;
}

async function otpLogin(phone) {
  const ip = `10.${rnd255()}.${rnd255()}.${1 + randomInt(254)}`;
  await call('POST', '/auth/send-otp', { body: { phone, purpose: 'LOGIN' }, headers: { 'X-Forwarded-For': ip } });
  const d = await call('POST', '/auth/verify-otp', { body: { phone, code: OTP_CODE }, headers: { 'X-Forwarded-For': ip } });
  return d.access_token;
}

async function adminLogin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL va ADMIN_PASSWORD env kerak (super admin)');
  return (await call('POST', '/auth/login', { body: { login: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).access_token;
}

async function close() {
  const data = JSON.parse(await readFile(OUT, 'utf8'));
  const admin = await adminLogin();
  await call('POST', `/admin/clubs/${data.club_id}/close`, { token: admin, body: { reason: 'loadtest cleanup' } });
  console.log(`Klub yopildi: ${data.club_id}`);
}

async function main() {
  if (process.env.CLOSE === '1') return close();
  const admin = await adminLogin();
  const ownerPhone = randomPhone();
  const ownerPassword = `Load#${randomUUID().slice(0, 12)}`;
  const tag = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

  // 1) Mijoz sifatida kirib klub yaratadi → klub egasi bo'ladi (paroli bilan admin panelga kiradi)
  let owner = await otpLogin(ownerPhone);
  const club = await call('POST', '/clubs', { token: owner, body: { name: `LOADTEST ${tag}`, phone: ownerPhone, owner_password: ownerPassword } });
  // Rollar o'zgardi — yangi token (OTP cooldown'ga urilmaslik uchun parol bilan)
  owner = (await call('POST', '/auth/login', { body: { login: ownerPhone, password: ownerPassword } })).access_token;

  // 2) Filial 24/7 — har qanday vaqtga bron qilish mumkin
  const branch = await call('POST', `/clubs/${club.id}/branches`, {
    token: owner,
    body: { name: 'Loadtest filial', address: 'Toshkent, Chilonzor 1', latitude: 41.28, longitude: 69.2, working_hours: { always_open: true } },
  });

  // 3) Kategoriya (kategoriya bo'yicha bron) + qurilmalar
  const cat = await call('POST', `/branches/${branch.id}/device-categories`, { token: owner, body: { name: 'Arena', device_type: 'PC' } });
  await call('POST', `/branches/${branch.id}/devices/bulk`, { token: owner, body: { prefix: 'PC-', from: 1, to: DEVICES, type: 'PC' } });
  await call('POST', `/branches/${branch.id}/devices/bulk`, { token: owner, body: { prefix: 'ARENA-', from: 1, to: CATEGORY_DEVICES, type: 'PC', category_id: cat.id } });
  const list = await call('GET', `/branches/${branch.id}/devices`, { token: owner });
  const devices = list.filter((d) => !d.category_id).sort((a, b) => a.name.localeCompare(b.name)).map((d) => d.id);
  const categoryDevices = list.filter((d) => d.category_id === cat.id).map((d) => d.id);

  // 4) Tarif (12 000 so'm/soat, tiyinda)
  const tariff = await call('POST', `/branches/${branch.id}/tariffs`, { token: owner, body: { name: 'Standart', price_per_hour: 1_200_000, device_type: 'PC' } });

  // 5) Moderatsiya → ACTIVE (ommaviy katalogda ko'rinadi)
  await call('POST', `/clubs/${club.id}/submit`, { token: owner });
  await call('POST', `/admin/clubs/${club.id}/approve`, { token: admin });

  const data = {
    base_url: BASE_URL,
    created_at: new Date().toISOString(),
    club_id: club.id,
    branch_id: branch.id,
    branch_slug: branch.slug ?? null,
    category_id: cat.id,
    category_devices: categoryDevices,
    devices,
    tariff_id: tariff.id,
    owner_phone: ownerPhone,
    owner_password: ownerPassword,
  };
  await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
  console.log(`Tayyor: klub ${club.id}, filial ${branch.id}, ${devices.length} PC + ${categoryDevices.length} kategoriya PC → ${OUT}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
