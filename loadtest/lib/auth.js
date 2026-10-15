import http from 'k6/http';
import { fail } from 'k6';
import { BASE_URL, json } from './config.js';

/*
 * Kirish yordamchilari.
 * OTP limitlari (apps/api/src/modules/auth/otp.service.ts): bitta telefon — 60 s cooldown va kuniga 10 ta kod,
 * bitta IP — soatiga 10 ta kod. Shuning uchun har kirish yangi tasodifiy telefon + soxta `X-Forwarded-For` bilan
 * (API `trust proxy: loopback` — XFF faqat lokal/loopback'dan kelganda hisobga olinadi; staging'da proksi o'z IP'sini yozadi).
 * Dev'da (TELEGRAM_BOT_TOKEN bo'sh, NODE_ENV != production) kod har doim 000000.
 */

const OTP_CODE = __ENV.OTP_CODE || '000000';
const rnd = (n) => Math.floor(Math.random() * n);

/** +998 9X XXX XX XX — har chaqiruvda yangi raqam (yuklama testi mijozlari). */
export const randomPhone = () => `+99899${String(rnd(1e7)).padStart(7, '0')}`;
export const randomIp = () => `10.${rnd(256)}.${rnd(256)}.${1 + rnd(254)}`;

/** Mijoz OTP orqali kiradi; access token qaytaradi (xatoda null — chaqiruvchi hal qiladi). */
export function customerLogin(phone = randomPhone()) {
  const ip = randomIp();
  const params = { headers: { ...json.headers, 'X-Forwarded-For': ip }, tags: { name: 'auth/send-otp' } };
  const s = http.post(`${BASE_URL}/auth/send-otp`, JSON.stringify({ phone, purpose: 'LOGIN' }), params);
  if (s.status !== 200) {
    console.error(`send-otp ${s.status}: ${s.body && String(s.body).slice(0, 200)}`);
    return null;
  }
  const v = http.post(`${BASE_URL}/auth/verify-otp`, JSON.stringify({ phone, code: OTP_CODE }), { ...params, tags: { name: 'auth/verify-otp' } });
  if (v.status !== 200) {
    console.error(`verify-otp ${v.status}: ${v.body && String(v.body).slice(0, 200)}`);
    return null;
  }
  return v.json('data.access_token');
}

/**
 * N ta mijoz tokeni (setup() ichida). Parallel `http.batch` bilan — 100 ta mijoz bir necha soniyada.
 * Har juftlik (send-otp → verify-otp) o'z IP'si bilan.
 */
export function customerTokens(n, batch = 20) {
  const out = [];
  while (out.length < n) {
    const size = Math.min(batch, n - out.length);
    const people = Array.from({ length: size }, () => ({ phone: randomPhone(), ip: randomIp() }));
    const hdr = (ip) => ({ headers: { ...json.headers, 'X-Forwarded-For': ip }, tags: { name: 'auth/send-otp' } });
    const sent = http.batch(people.map((p) => ['POST', `${BASE_URL}/auth/send-otp`, JSON.stringify({ phone: p.phone, purpose: 'LOGIN' }), hdr(p.ip)]));
    const ok = people.filter((_, i) => sent[i].status === 200);
    const verified = http.batch(
      ok.map((p) => ['POST', `${BASE_URL}/auth/verify-otp`, JSON.stringify({ phone: p.phone, code: OTP_CODE }), { ...hdr(p.ip), tags: { name: 'auth/verify-otp' } }]),
    );
    for (const r of verified) if (r.status === 200) out.push(r.json('data.access_token'));
    if (ok.length === 0 || verified.every((r) => r.status !== 200)) {
      fail(`mijoz kirishi ishlamadi: send-otp ${sent[0].status} ${String(sent[0].body).slice(0, 200)}`);
    }
  }
  return out;
}

/** Xodim (super admin / klub egasi) email yoki telefon + parol bilan kiradi. */
export function staffLogin(login, password) {
  if (!login || !password) fail('xodim kirishi uchun ADMIN_EMAIL va ADMIN_PASSWORD kerak');
  const r = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ login, password }), { ...json, tags: { name: 'auth/login' } });
  if (r.status !== 200) fail(`xodim kirishi: ${r.status} ${String(r.body).slice(0, 200)}`);
  return r.json('data.access_token');
}
