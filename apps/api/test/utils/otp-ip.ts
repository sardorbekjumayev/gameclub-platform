import { api, Harness, rndPhone } from './harness';

/**
 * OTP IP limiti (soatiga 10) barcha parallel spec'lar uchun umumiy (hammasi 127.0.0.1 dan).
 * Ilova `trust proxy: loopback` — shuning uchun har login'ga alohida `X-Forwarded-For` beriladi,
 * va bu Harness nusxasining login'lari boshqa spec'lar bilan bir limitga urilmaydi.
 */
export function isolateOtpRateLimit(h: Harness) {
  const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  h.otpLogin = async (phone = rndPhone()) => {
    await h.redis.del(`otp:cooldown:${phone}`);
    const from = ip();
    await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', from).send({ phone, purpose: 'LOGIN' }).expect(200);
    const res = await h.http.post(api('/auth/verify-otp')).set('X-Forwarded-For', from).send({ phone, code: '000000' }).expect(200);
    return res.body.data.access_token as string;
  };
  return h;
}
