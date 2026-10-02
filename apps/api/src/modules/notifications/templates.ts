/** Bildirishnoma shablonlari (docs/01-API.md §6.15). {var} — o'rniga qo'yiladi. */
type Lang = 'uz' | 'ru' | 'en';
type T = Record<Lang, [title: string, body: string]>;

export const TEMPLATES: Record<string, T> = {
  BOOKING_CREATED: {
    uz: ['Bron yaratildi', '{code}: {club} — {when}. To\'lovni {minutes} daqiqa ichida yakunlang.'],
    ru: ['Бронь создана', '{code}: {club} — {when}. Оплатите в течение {minutes} мин.'],
    en: ['Booking created', '{code}: {club} — {when}. Complete payment within {minutes} min.'],
  },
  BOOKING_CONFIRMED: {
    uz: ['Bron tasdiqlandi', '{code}: {club} — {when}. Klubga kelganda QR kodni ko\'rsating.'],
    ru: ['Бронь подтверждена', '{code}: {club} — {when}. Покажите QR-код в клубе.'],
    en: ['Booking confirmed', '{code}: {club} — {when}. Show the QR code at the club.'],
  },
  BOOKING_CANCELLED: {
    uz: ['Bron bekor qilindi', '{code} bekor qilindi. Qaytariladigan summa: {refund}.'],
    ru: ['Бронь отменена', '{code} отменена. Сумма возврата: {refund}.'],
    en: ['Booking cancelled', '{code} was cancelled. Refund: {refund}.'],
  },
  BOOKING_EXPIRED: {
    uz: ['Bron muddati tugadi', '{code} uchun to\'lov o\'z vaqtida qilinmadi.'],
    ru: ['Бронь истекла', 'Оплата для {code} не поступила вовремя.'],
    en: ['Booking expired', 'Payment for {code} was not completed in time.'],
  },
  NO_SHOW_WARNING: {
    uz: ['Siz kelmadingiz', '{code} bo\'yicha kelmaganingiz qayd etildi. Takrorlansa bron qilish cheklanadi.'],
    ru: ['Вы не пришли', 'По брони {code} зафиксирована неявка. При повторе бронирование будет ограничено.'],
    en: ['No-show recorded', 'You did not show up for {code}. Repeated no-shows will restrict booking.'],
  },
  PAYMENT_SUCCESS: {
    uz: ['To\'lov qabul qilindi', '{amount} to\'landi ({code}).'],
    ru: ['Оплата получена', 'Оплачено {amount} ({code}).'],
    en: ['Payment received', '{amount} paid ({code}).'],
  },
  PAYMENT_FAILED: {
    uz: ['To\'lov amalga oshmadi', '{code} uchun to\'lov o\'tmadi. Qayta urinib ko\'ring.'],
    ru: ['Оплата не прошла', 'Оплата для {code} не прошла. Попробуйте снова.'],
    en: ['Payment failed', 'Payment for {code} failed. Please try again.'],
  },
  REFUND_COMPLETED: {
    uz: ['Pul qaytarildi', '{amount} qaytarildi ({code}).'],
    ru: ['Возврат выполнен', 'Возвращено {amount} ({code}).'],
    en: ['Refund completed', '{amount} refunded ({code}).'],
  },
  SESSION_STARTED: {
    uz: ['Sessiya boshlandi', '{device} — {until} gacha. Yaxshi o\'yin!'],
    ru: ['Сессия началась', '{device} — до {until}. Хорошей игры!'],
    en: ['Session started', '{device} — until {until}. Have fun!'],
  },
  SESSION_ENDED: {
    uz: ['Sessiya tugadi', '{device} sessiyasi yakunlandi. Klubni baholang!'],
    ru: ['Сессия завершена', 'Сессия на {device} завершена. Оцените клуб!'],
    en: ['Session ended', 'Your session on {device} has ended. Rate the club!'],
  },
  CLUB_APPROVED: {
    uz: ['Klub tasdiqlandi', '"{club}" platformada faollashtirildi.'],
    ru: ['Клуб одобрен', '"{club}" активирован на платформе.'],
    en: ['Club approved', '"{club}" is now live on the platform.'],
  },
  CLUB_REJECTED: {
    uz: ['Klub arizasi rad etildi', '"{club}": {reason}'],
    ru: ['Заявка клуба отклонена', '"{club}": {reason}'],
    en: ['Club application rejected', '"{club}": {reason}'],
  },
  CLUB_SUSPENDED: {
    uz: ['Klub to\'xtatildi', '"{club}": {reason}'],
    ru: ['Клуб приостановлен', '"{club}": {reason}'],
    en: ['Club suspended', '"{club}": {reason}'],
  },
  NEW_BOOKING: {
    uz: ['Yangi bron', '{code} — {when}, {devices}.'],
    ru: ['Новая бронь', '{code} — {when}, {devices}.'],
    en: ['New booking', '{code} — {when}, {devices}.'],
  },
  REVIEW_REPLY: {
    uz: ['Klub sharhingizga javob berdi', '{club}: {reply}'],
    ru: ['Клуб ответил на ваш отзыв', '{club}: {reply}'],
    en: ['The club replied to your review', '{club}: {reply}'],
  },
  TICKET_REPLY: {
    uz: ['Murojaatingizga javob', '{subject}'],
    ru: ['Ответ на обращение', '{subject}'],
    en: ['Reply to your ticket', '{subject}'],
  },
  CASH_DIFFERENCE: {
    uz: ['Kassa farqi', '{branch}: smena yopildi, farq {amount}.'],
    ru: ['Расхождение в кассе', '{branch}: смена закрыта, расхождение {amount}.'],
    en: ['Cash difference', '{branch}: shift closed with difference {amount}.'],
  },
  BOOKING_REMINDER: {
    uz: ['Bron eslatmasi', '{code}: {club} — {when} ({minutes} daqiqadan keyin).'],
    ru: ['Напоминание о брони', '{code}: {club} — {when} (через {minutes} мин).'],
    en: ['Booking reminder', '{code}: {club} — {when} (in {minutes} min).'],
  },
  SESSION_ENDING_SOON: {
    uz: ['Sessiya tugayapti', 'Sessiyangiz {until} da tugaydi. Uzaytirish uchun operatorga murojaat qiling.'],
    ru: ['Сеанс заканчивается', 'Ваш сеанс закончится в {until}. Для продления обратитесь к оператору.'],
    en: ['Session ending soon', 'Your session ends at {until}. Ask the operator to extend.'],
  },
  REVIEW_REQUEST: {
    uz: ['Qanday o\'tdi?', '{club} haqida fikringizni qoldiring ({code}).'],
    ru: ['Как всё прошло?', 'Оставьте отзыв о {club} ({code}).'],
    en: ['How was it?', 'Leave a review for {club} ({code}).'],
  },
  ANNOUNCEMENT: {
    uz: ['{title}', '{body}'],
    ru: ['{title}', '{body}'],
    en: ['{title}', '{body}'],
  },
};

export function render(type: string, lang: string, vars: Record<string, string | number>): { title: string; body: string } {
  const t = TEMPLATES[type]?.[(lang as Lang) in (TEMPLATES[type] ?? {}) ? (lang as Lang) : 'uz'] ?? [type, ''];
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  return { title: fill(t[0]), body: fill(t[1]) };
}
