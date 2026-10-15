import { api, bearer, Harness, TestClub } from './harness';

/**
 * Umumiy oqimlar: walk-in (mijoz telefoni bilan) → naqd to'lov → sessiya stop → bron COMPLETED.
 * Sharhlar va analitika testlari uchun haqiqiy (API orqali) yakunlangan bron.
 * `operator` — smena bitta filialga bog'liq; boshqa filial uchun shu filial xodimi tokeni beriladi.
 */
export async function completedBooking(h: Harness, club: TestClub, customerPhone: string, deviceIdx = 0, minutes = 60, operator = club.owner) {
  await h.openShift(operator, club.branchId);
  const w = await h.http
    .post(api('/bookings/walk-in'))
    .set(bearer(operator))
    .send({ branch_id: club.branchId, device_ids: [club.devices[deviceIdx]], duration_minutes: minutes, payment_method: 'CASH', guest_phone: customerPhone, guest_name: 'E2E mijoz' });
  if (w.status !== 201) throw new Error(`walk-in failed: ${w.status} ${JSON.stringify(w.body)}`);
  const bookingId = w.body.data.id as string;
  const active = await h.http.get(api(`/sessions/active?branch_id=${club.branchId}`)).set(bearer(operator)).expect(200);
  const session = (active.body.data as { id: string; booking_id: string }[]).find((s) => s.booking_id === bookingId);
  if (!session) throw new Error('walk-in session not found');
  const stop = await h.http.post(api(`/sessions/${session.id}/stop`)).set(bearer(operator)).send({}).expect(201);
  if (stop.body.data.booking?.status && stop.body.data.booking.status !== 'COMPLETED') throw new Error(`booking not completed: ${stop.body.data.booking.status}`);
  return { bookingId, total: Number(w.body.data.total_amount) };
}

/** Xodim smenasini yopadi (harness faqat egalarnikini yopadi). */
export async function closeShift(h: Harness, token: string) {
  const cur = await h.http.get(api('/shifts/current')).set(bearer(token));
  if (cur.body?.data?.id) await h.http.post(api(`/shifts/${cur.body.data.id}/close`)).set(bearer(token)).send({ counted_cash: 0 });
}

/**
 * OTP IP limiti (10/soat) barcha parallel e2e jarayonlar uchun umumiy (bitta 127.0.0.1) —
 * mijoz/klub yaratishdan oldin limit kalitlari tozalanadi.
 */
async function resetOtpIp(h: Harness) {
  // Faqat lokal (loopback) IP kaliti; `login:*` va soxta IP'lar (limit testlari) ga tegmaymiz
  const keys = (await h.redis.keys('otp:ip:*')).filter((k) => /127\.0\.0\.1$|::1$/.test(k));
  if (keys.length) await h.redis.del(...keys);
}

export async function newCustomer(h: Harness) {
  await resetOtpIp(h);
  return h.customer();
}

export async function newClub(h: Harness, opts: Parameters<Harness['club']>[0] = {}) {
  await resetOtpIp(h);
  return h.club(opts);
}
