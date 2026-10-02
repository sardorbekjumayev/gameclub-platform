import { DateTime } from 'luxon';

/** Bildirishnoma matnlari uchun (klientlar o'zi formatlaydi). */
export const fmtMoney = (tiyin: bigint | number) =>
  `${Math.trunc(Number(tiyin) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;

export const fmtWhen = (d: Date, tz = 'Asia/Tashkent') => DateTime.fromJSDate(d, { zone: tz }).toFormat('dd.MM.yyyy HH:mm');
export const fmtTime = (d: Date, tz = 'Asia/Tashkent') => DateTime.fromJSDate(d, { zone: tz }).toFormat('HH:mm');
