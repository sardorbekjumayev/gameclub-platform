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
    uz: ['Bron tasdiqlandi', '{code}: {club} — {when}. Klubga kelganda chiptani ko\'rsating.'],
    ru: ['Бронь подтверждена', '{code}: {club} — {when}. Покажите билет в клубе.'],
    en: ['Booking confirmed', '{code}: {club} — {when}. Show your ticket at the club.'],
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
  TRANSFER_PENDING: {
    uz: ['Kartaga o\'tkazmani tekshiring', '{code}: {payer} (karta …{last4}) {amount} o\'tkazganini bildirdi. Tasdiqlang yoki rad eting.'],
    ru: ['Проверьте перевод на карту', '{code}: {payer} (карта …{last4}) сообщил о переводе {amount}. Подтвердите или отклоните.'],
    en: ['Check the card transfer', '{code}: {payer} (card …{last4}) reports a transfer of {amount}. Confirm or reject it.'],
  },
  TRANSFER_CONFIRMED: {
    uz: ['To\'lovingiz tasdiqlandi', '{code}: {amount} o\'tkazmangiz operator tomonidan tasdiqlandi. Rahmat!'],
    ru: ['Оплата подтверждена', '{code}: перевод {amount} подтверждён оператором. Спасибо!'],
    en: ['Payment confirmed', '{code}: your transfer of {amount} was confirmed by the operator. Thank you!'],
  },
  TRANSFER_REJECTED: {
    uz: ['O\'tkazma tasdiqlanmadi', '{code}: klub o\'tkazmangizni topmadi — {reason}. Bron saqlanadi: qayta tekshirib yuboring yoki klubda to\'lang.'],
    ru: ['Перевод не подтверждён', '{code}: клуб не нашёл ваш перевод — {reason}. Бронь сохранена: проверьте и отправьте снова или оплатите в клубе.'],
    en: ['Transfer not confirmed', '{code}: the club could not find your transfer — {reason}. Your booking is kept: check and resubmit, or pay at the club.'],
  },
  REFUND_PENDING: {
    uz: ['Pul qaytariladi', '{code}: {amount} klub tomonidan kartangizga qaytariladi.'],
    ru: ['Деньги будут возвращены', '{code}: клуб вернёт {amount} на вашу карту.'],
    en: ['Refund on the way', '{code}: the club will return {amount} to your card.'],
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
  SESSION_STARTED_OPEN: {
    uz: ['VIP sessiya boshlandi', '{device} — vaqt ochiq. O\'ynaganingizcha hisoblanadi, to\'lov oxirida. Yaxshi o\'yin!'],
    ru: ['VIP-сессия началась', '{device} — время открыто. Оплата в конце по фактическому времени. Хорошей игры!'],
    en: ['VIP session started', '{device} — open time. You pay at the end for the time played. Have fun!'],
  },
  SESSION_ENDED_OPEN: {
    uz: ['VIP sessiya tugadi', '{device}: {minutes} daqiqa — {amount}. Klubni baholang!'],
    ru: ['VIP-сессия завершена', '{device}: {minutes} мин — {amount}. Оцените клуб!'],
    en: ['VIP session ended', '{device}: {minutes} min — {amount}. Rate the club!'],
  },
  OPEN_SESSION_LIMIT_SOON: {
    uz: ['VIP vaqti tugayapti', '{device} {until} da bron qilingan. VIP sessiyani yakunlang yoki boshqa joyga ko\'chiring.'],
    ru: ['Скоро бронь на месте VIP', '{device} забронирован на {until}. Завершите VIP-сессию или пересадите гостя.'],
    en: ['VIP seat is booked soon', '{device} is booked at {until}. End the VIP session or move the guest.'],
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
  TICKET_RESOLVED: {
    uz: ['Murojaatingiz hal qilindi', '{subject}. Savol qolsa, shu murojaatga yozing.'],
    ru: ['Обращение решено', '{subject}. Если остались вопросы, напишите в это обращение.'],
    en: ['Your ticket was resolved', '{subject}. Reply to the ticket if you still need help.'],
  },
  TICKET_CLOSED: {
    uz: ['Murojaat yopildi', '{subject}'],
    ru: ['Обращение закрыто', '{subject}'],
    en: ['Ticket closed', '{subject}'],
  },
  TICKET_NEW: {
    uz: ['Yangi murojaat', '{subject}'],
    ru: ['Новое обращение', '{subject}'],
    en: ['New ticket', '{subject}'],
  },
  TICKET_USER_REPLY: {
    uz: ['Murojaatga yangi xabar', '{subject}'],
    ru: ['Новое сообщение в обращении', '{subject}'],
    en: ['New message in ticket', '{subject}'],
  },
  CASH_DIFFERENCE: {
    uz: ['Kassa farqi', '{branch}: smena yopildi, farq {amount}.'],
    ru: ['Расхождение в кассе', '{branch}: смена закрыта, расхождение {amount}.'],
    en: ['Cash difference', '{branch}: shift closed with difference {amount}.'],
  },
  RENTAL_REQUESTED: {
    uz: ['Arenda so\'rovi yuborildi', '{code}: {item} — {when}. Klub tasdiqlashini kuting.'],
    ru: ['Заявка на аренду отправлена', '{code}: {item} — {when}. Ожидайте подтверждения клуба.'],
    en: ['Rental request sent', '{code}: {item} — {when}. Waiting for the club to confirm.'],
  },
  NEW_RENTAL: {
    uz: ['Yangi arenda so\'rovi', '{code}: {item} × {qty}, {when} ({fulfillment}). Tasdiqlang yoki rad eting.'],
    ru: ['Новая заявка на аренду', '{code}: {item} × {qty}, {when} ({fulfillment}). Подтвердите или отклоните.'],
    en: ['New rental request', '{code}: {item} × {qty}, {when} ({fulfillment}). Confirm or reject it.'],
  },
  RENTAL_CONFIRMED: {
    uz: ['Arenda tasdiqlandi', '{code}: {item} — {when}. {club} sizni kutadi.'],
    ru: ['Аренда подтверждена', '{code}: {item} — {when}. {club} ждёт вас.'],
    en: ['Rental confirmed', '{code}: {item} — {when}. {club} is expecting you.'],
  },
  RENTAL_REJECTED: {
    uz: ['Arenda rad etildi', '{code}: klub so\'rovni rad etdi — {reason}.'],
    ru: ['Аренда отклонена', '{code}: клуб отклонил заявку — {reason}.'],
    en: ['Rental rejected', '{code}: the club rejected the request — {reason}.'],
  },
  RENTAL_CANCELLED: {
    uz: ['Arenda bekor qilindi', '{code}: {item} arendasi bekor qilindi.'],
    ru: ['Аренда отменена', '{code}: аренда {item} отменена.'],
    en: ['Rental cancelled', '{code}: the {item} rental was cancelled.'],
  },
  RENTAL_HANDED_OVER: {
    uz: ['Konsol topshirildi', '{code}: {item}. Qaytarish vaqti — {until}. Yaxshi o\'yin!'],
    ru: ['Консоль выдана', '{code}: {item}. Вернуть до {until}. Приятной игры!'],
    en: ['Console handed over', '{code}: {item}. Return by {until}. Have fun!'],
  },
  RENTAL_RETURNED: {
    uz: ['Arenda yakunlandi', '{code}: {item} qaytarildi. Rahmat!'],
    ru: ['Аренда завершена', '{code}: {item} возвращена. Спасибо!'],
    en: ['Rental completed', '{code}: {item} returned. Thank you!'],
  },
  RENTAL_EXPIRED: {
    uz: ['Arenda muddati o\'tdi', '{code}: so\'rov o\'z vaqtida tasdiqlanmadi yoki konsol olib ketilmadi.'],
    ru: ['Аренда истекла', '{code}: заявка не была вовремя подтверждена или консоль не забрали.'],
    en: ['Rental expired', '{code}: the request was not confirmed in time or the console was not picked up.'],
  },
  RENTAL_ENDING_SOON: {
    uz: ['Arenda tugashiga oz qoldi', '{code}: {item} ni {until} gacha qaytaring.'],
    ru: ['Аренда скоро закончится', '{code}: верните {item} до {until}.'],
    en: ['Rental ending soon', '{code}: please return {item} by {until}.'],
  },
  RENTAL_OVERDUE: {
    uz: ['Qaytarish vaqti o\'tdi', '{code}: {item} {until} da qaytarilishi kerak edi. Kechikish uchun qo\'shimcha haq olinishi mumkin.'],
    ru: ['Срок возврата истёк', '{code}: {item} нужно было вернуть в {until}. За просрочку может взиматься доплата.'],
    en: ['Return overdue', '{code}: {item} was due back at {until}. A late fee may apply.'],
  },
  RENTAL_OVERDUE_STAFF: {
    uz: ['Konsol qaytarilmadi', '{code}: {item} {until} da qaytarilishi kerak edi.'],
    ru: ['Консоль не возвращена', '{code}: {item} должна была вернуться в {until}.'],
    en: ['Console not returned', '{code}: {item} was due back at {until}.'],
  },
  PASSWORD_RESET_BY_ADMIN: {
    uz: ['Parolingiz tiklandi', '{club} administratori admin panel parolingizni tikladi. Vaqtinchalik parolni administratordan oling va kirgach yangisini o\'rnating. Bu siz so\'ramagan bo\'lsa, darhol administratorga murojaat qiling.'],
    ru: ['Пароль сброшен', 'Администратор {club} сбросил ваш пароль от админ-панели. Получите временный пароль у администратора и после входа задайте новый. Если вы этого не запрашивали, немедленно свяжитесь с администратором.'],
    en: ['Your password was reset', 'An administrator of {club} reset your admin panel password. Get the temporary password from them and set a new one after signing in. If you did not request this, contact your administrator immediately.'],
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
