import type { LegalTexts } from './types';

/** Maxfiylik siyosati — ZRU-547 "Shaxsga doir ma'lumotlar to'g'risida" qonuniga muvofiq (qoralama). */
export const PRIVACY: LegalTexts = {
  uz: {
    title: 'Maxfiylik siyosati',
    body: `**Tahrir sanasi:** [Tahrir sanasi]

Ushbu siyosat [Kompaniya nomi] (STIR: [STIR], manzil: [Yuridik manzil]; keyingi o'rinlarda — "Operator") Zonup platformasi (zonup.uz sayti, mobil ilova, Telegram bot) foydalanuvchilarining shaxsga doir ma'lumotlarini qanday to'plashi, ishlatishi, saqlashi va himoya qilishini tushuntiradi. Siyosat O'zbekiston Respublikasining 2019-yil 2-iyuldagi O'RQ-547-son "Shaxsga doir ma'lumotlar to'g'risida"gi Qonuni va boshqa qonun hujjatlariga muvofiq tuzilgan.

## 1. Qanday ma'lumotlar to'planadi

1.1. **Hisob ma'lumotlari:** telefon raqami (kirish uchun majburiy), ism va familiya, til sozlamasi.

1.2. **Telegram ma'lumotlari:** tasdiqlash kodini bot orqali olish uchun Telegram foydalanuvchi identifikatori (Telegram ID) va bot bilan yozishmalar holati.

1.3. **Bron tarixi:** qaysi klub, filial va qurilma bron qilingani, vaqt, holat (tasdiqlangan, bekor qilingan, kelmadi), sessiyalar, sharhlar, sevimli klublar va murojaatlar.

1.4. **To'lov metama'lumotlari:** to'lov summasi, usuli, holati, to'lov tizimi tranzaksiya identifikatori, kartaga o'tkazmada — to'lovchi ismi va karta raqamining oxirgi 4 raqami. Karta raqamining to'liq ma'lumotlari, amal qilish muddati va CVV kodi Operator tomonidan saqlanmaydi — ularni to'lov tizimlari (Payme, Click va boshqalar) qayta ishlaydi.

1.5. **Chek rasmlari:** kartaga o'tkazma orqali to'lashda Mijoz yuklagan to'lov cheki (skrinshot) rasmlari.

1.6. **Qurilma ma'lumotlari:** push-bildirishnomalar uchun qurilma tokeni, qurilma turi va operatsion tizim, ilova versiyasi, IP-manzil va brauzer ma'lumotlari (xavfsizlik va audit uchun).

1.7. **Joylashuv:** faqat Mijoz ruxsat bergan taqdirda — yaqin klublarni ko'rsatish uchun taxminiy yoki aniq geolokatsiya. Joylashuv tarixi saqlanmaydi.

## 2. Ma'lumotlardan foydalanish maqsadlari

2.1. Ma'lumotlar quyidagi maqsadlarda qayta ishlanadi:
- hisobni yaratish va telefon raqamini tasdiqlash;
- bronlarni yaratish, tasdiqlash, eslatish va bekor qilish;
- to'lovlarni qabul qilish, kartaga o'tkazmalarni klub tomonidan tekshirish va pulni qaytarish;
- bron holati, eslatmalar va e'lonlar haqida bildirishnoma yuborish;
- kelmaslik (no-show) cheklovlarini qo'llash, firibgarlik va suiiste'mollarning oldini olish;
- murojaatlarga javob berish va nizolarni hal qilish;
- xizmat sifatini oshirish uchun umumlashtirilgan (anonim) statistika;
- qonun talablarini bajarish (buxgalteriya, soliq va vakolatli organlar so'rovlari).

2.2. Operator ma'lumotlarni reklama maqsadida uchinchi shaxslarga sotmaydi.

## 3. Ma'lumotlarni klublarga va uchinchi shaxslarga berish

3.1. Mijoz bron qilgan Klub bronni bajarish uchun zarur bo'lgan ma'lumotlarni ko'radi: ism, telefon raqami, bron tafsilotlari, to'lov holati, kartaga o'tkazmada — to'lovchi ismi, karta oxirgi 4 raqami va chek rasmi.

3.2. To'lov tizimlari to'lovni amalga oshirish uchun zarur ma'lumotlarni oladi.

3.3. Telegram (bot orqali kod yuborish) va push-bildirishnoma xizmatlari (Firebase Cloud Messaging) faqat xabar yetkazish uchun zarur bo'lgan minimal ma'lumotni oladi.

3.4. Qonunda nazarda tutilgan hollarda ma'lumotlar vakolatli davlat organlariga beriladi.

## 4. Saqlash joyi (lokalizatsiya)

4.1. O'RQ-547-son Qonunning 27¹-moddasi talabiga muvofiq, O'zbekiston Respublikasi fuqarolarining shaxsga doir ma'lumotlari O'zbekiston Respublikasi hududida joylashgan serverlarda to'planadi, tizimlashtiriladi va saqlanadi hamda Shaxsga doir ma'lumotlar bazalari davlat reestrida ro'yxatdan o'tkaziladi.

4.2. Ma'lumotlarni transchegaraviy uzatish (masalan, Telegram yoki push-xizmatlar orqali xabar yuborish) faqat qonunda belgilangan shartlarda va xizmatni ko'rsatish uchun zarur hajmda amalga oshiriladi.

## 5. Saqlash muddatlari

5.1. Hisob ma'lumotlari — hisob faol bo'lgan davrda va u o'chirilgandan keyin 30 kungacha.

5.2. Bron va to'lov yozuvlari — buxgalteriya va soliq qonunchiligi talab qiladigan muddat davomida (5 yilgacha), keyin anonimlashtiriladi yoki o'chiriladi.

5.3. Chek rasmlari — to'lov tasdiqlangan yoki rad etilganidan keyin 1 yilgacha (nizolarni hal qilish uchun).

5.4. Qurilma tokenlari — Mijoz tizimdan chiqqanda yoki token yaroqsiz bo'lganda o'chiriladi.

5.5. Audit va xavfsizlik jurnallari — 1 yilgacha.

## 6. Ma'lumotlarni himoya qilish

6.1. Operator ma'lumotlarni himoya qilish uchun tashkiliy va texnik choralar ko'radi: shifrlangan ulanish (HTTPS), kirish huquqlarini rollar bo'yicha cheklash, har bir klub faqat o'z mijozlari ma'lumotlarini ko'rishi, parollarni xeshlab saqlash, muhim amallarni audit jurnaliga yozish.

6.2. Tasdiqlash kodlari, tokenlar va parollar jurnallarga yozilmaydi.

## 7. Mijozning huquqlari

7.1. Mijoz quyidagi huquqlarga ega:
- o'zi haqidagi ma'lumotlar qayta ishlanayotganini bilish va ulardan nusxa olish;
- noto'g'ri ma'lumotlarni tuzatish (profil sahifasida yoki murojaat orqali);
- hisobni va ma'lumotlarni o'chirishni talab qilish (qonun saqlashni talab qiladigan yozuvlar bundan mustasno);
- rozilikni qaytarib olish (bu holda xizmatdan foydalanish imkoni cheklanishi mumkin);
- bildirishnomalar va joylashuvga ruxsatni istalgan vaqtda o'chirish;
- vakolatli organga yoki sudga shikoyat qilish.

7.2. So'rovlar [Aloqa email] yoki Platformadagi "Yordam" bo'limi orqali yuboriladi va qonunda belgilangan muddatda ko'rib chiqiladi.

## 8. Cookie va mahalliy saqlash

8.1. Sayt kirish holati va til sozlamasini brauzerning mahalliy xotirasida saqlaydi. Reklama kuzatuv cookie-fayllaridan foydalanilmaydi.

## 9. Bolalar

9.1. Platforma 16 yoshdan kichik shaxslarga ota-ona roziligisiz mo'ljallanmagan. Agar bunday ma'lumot roziliksiz to'planganini bilsak, uni o'chiramiz.

## 10. O'zgartirishlar

10.1. Siyosatning yangi tahriri Platformada e'lon qilingan kundan kuchga kiradi. Muhim o'zgarishlar haqida Mijozlar ilova yoki sayt orqali xabardor qilinadi.

## 11. Aloqa

- **Operator:** [Kompaniya nomi]
- **STIR:** [STIR]
- **Manzil:** [Yuridik manzil]
- **Email:** [Aloqa email]
- **Telefon:** [Telefon]
`,
  },
  ru: {
    title: 'Политика конфиденциальности',
    body: `**Дата редакции:** [Tahrir sanasi]

Настоящая политика объясняет, как [Kompaniya nomi] (ИНН: [STIR], адрес: [Yuridik manzil]; далее — «Оператор») собирает, использует, хранит и защищает персональные данные пользователей платформы Zonup (сайт zonup.uz, мобильное приложение, Telegram-бот). Политика составлена в соответствии с Законом Республики Узбекистан от 2 июля 2019 года № ЗРУ-547 «О персональных данных» и иными актами законодательства.

## 1. Какие данные собираются

1.1. **Данные аккаунта:** номер телефона (обязателен для входа), имя и фамилия, выбранный язык.

1.2. **Данные Telegram:** идентификатор пользователя Telegram (Telegram ID) для получения кода подтверждения через бота и статус переписки с ботом.

1.3. **История бронирований:** какой клуб, филиал и устройство забронированы, время, статус (подтверждено, отменено, неявка), сессии, отзывы, избранные клубы и обращения.

1.4. **Метаданные платежей:** сумма, способ и статус оплаты, идентификатор транзакции платёжной системы, при переводе на карту — имя плательщика и последние 4 цифры карты. Полный номер карты, срок действия и CVV Оператор не хранит — их обрабатывают платёжные системы (Payme, Click и другие).

1.5. **Изображения чеков:** скриншоты чеков, которые Клиент загружает при оплате переводом на карту.

1.6. **Данные устройства:** токен для push-уведомлений, тип устройства и ОС, версия приложения, IP-адрес и данные браузера (для безопасности и аудита).

1.7. **Геолокация:** только с разрешения Клиента — приблизительное или точное местоположение для показа ближайших клубов. История перемещений не сохраняется.

## 2. Цели обработки

2.1. Данные обрабатываются для:
- создания аккаунта и подтверждения номера телефона;
- создания, подтверждения, напоминания и отмены бронирований;
- приёма платежей, проверки переводов на карту клубом и возврата средств;
- отправки уведомлений о статусе бронирования, напоминаний и объявлений;
- применения ограничений за неявки, предотвращения мошенничества и злоупотреблений;
- ответа на обращения и разрешения споров;
- обобщённой (анонимной) статистики для улучшения сервиса;
- исполнения требований закона (бухгалтерия, налоги, запросы уполномоченных органов).

2.2. Оператор не продаёт данные третьим лицам в рекламных целях.

## 3. Передача данных клубам и третьим лицам

3.1. Клуб, в котором Клиент оформил бронирование, видит данные, необходимые для его исполнения: имя, номер телефона, детали бронирования, статус оплаты, при переводе на карту — имя плательщика, последние 4 цифры карты и изображение чека.

3.2. Платёжные системы получают данные, необходимые для проведения платежа.

3.3. Telegram (отправка кодов через бота) и сервисы push-уведомлений (Firebase Cloud Messaging) получают минимальные данные, необходимые для доставки сообщений.

3.4. В случаях, предусмотренных законом, данные передаются уполномоченным государственным органам.

## 4. Место хранения (локализация)

4.1. В соответствии со статьёй 27¹ Закона ЗРУ-547 персональные данные граждан Республики Узбекистан собираются, систематизируются и хранятся на серверах, расположенных на территории Республики Узбекистан, а базы персональных данных регистрируются в Государственном реестре баз персональных данных.

4.2. Трансграничная передача данных (например, при отправке сообщений через Telegram или push-сервисы) осуществляется только на условиях, установленных законом, и в объёме, необходимом для оказания услуги.

## 5. Сроки хранения

5.1. Данные аккаунта — в течение срока его действия и до 30 дней после удаления.

5.2. Записи о бронированиях и платежах — в течение срока, требуемого бухгалтерским и налоговым законодательством (до 5 лет), затем обезличиваются или удаляются.

5.3. Изображения чеков — до 1 года после подтверждения или отклонения платежа (для разрешения споров).

5.4. Токены устройств — удаляются при выходе из аккаунта или когда токен становится недействительным.

5.5. Журналы аудита и безопасности — до 1 года.

## 6. Защита данных

6.1. Оператор применяет организационные и технические меры защиты: шифрованное соединение (HTTPS), ограничение доступа по ролям, каждый клуб видит только данные своих клиентов, хранение паролей в виде хешей, запись важных действий в журнал аудита.

6.2. Коды подтверждения, токены и пароли не записываются в журналы.

## 7. Права Клиента

7.1. Клиент вправе:
- знать о факте обработки своих данных и получать их копию;
- исправлять неточные данные (в профиле или через обращение);
- требовать удаления аккаунта и данных (кроме записей, хранение которых требует закон);
- отозвать согласие (в этом случае возможность пользоваться сервисом может быть ограничена);
- в любой момент отключить уведомления и доступ к геолокации;
- обжаловать действия Оператора в уполномоченном органе или суде.

7.2. Запросы направляются на [Aloqa email] или через раздел «Поддержка» на Платформе и рассматриваются в установленный законом срок.

## 8. Cookie и локальное хранилище

8.1. Сайт хранит состояние входа и выбранный язык в локальном хранилище браузера. Рекламные отслеживающие cookie не используются.

## 9. Дети

9.1. Платформа не предназначена для лиц младше 16 лет без согласия родителей. Если нам станет известно, что такие данные собраны без согласия, мы их удалим.

## 10. Изменения

10.1. Новая редакция политики вступает в силу с момента её публикации на Платформе. О существенных изменениях Клиенты уведомляются через приложение или сайт.

## 11. Контакты

- **Оператор:** [Kompaniya nomi]
- **ИНН:** [STIR]
- **Адрес:** [Yuridik manzil]
- **Email:** [Aloqa email]
- **Телефон:** [Telefon]
`,
  },
  en: {
    title: 'Privacy Policy',
    body: `**Effective date:** [Tahrir sanasi]

This policy explains how [Kompaniya nomi] (TIN: [STIR], address: [Yuridik manzil]; the "Operator") collects, uses, stores and protects the personal data of users of the Zonup platform (the zonup.uz website, the mobile app and the Telegram bot). It is prepared in accordance with Law of the Republic of Uzbekistan No. ZRU-547 "On Personal Data" of 2 July 2019 and other applicable legislation.

## 1. Data we collect

1.1. **Account data:** phone number (required to sign in), first and last name, language preference.

1.2. **Telegram data:** your Telegram user ID, used to deliver confirmation codes through our bot, and the status of your chat with the bot.

1.3. **Booking history:** the club, branch and device booked, times, status (confirmed, cancelled, no-show), sessions, reviews, favourite clubs and support requests.

1.4. **Payment metadata:** amount, method and status, the payment system's transaction ID, and for card transfers the payer's name and the last 4 digits of the card. The Operator does not store full card numbers, expiry dates or CVV codes — these are processed by payment systems (Payme, Click and others).

1.5. **Receipt images:** screenshots of payment receipts that you upload when paying by card transfer.

1.6. **Device data:** push notification token, device type and OS, app version, IP address and browser information (for security and audit).

1.7. **Location:** only if you allow it — approximate or precise location to show nearby clubs. Location history is not stored.

## 2. Purposes of processing

2.1. We process data to:
- create your account and verify your phone number;
- create, confirm, remind about and cancel bookings;
- accept payments, let clubs verify card transfers, and process refunds;
- send notifications about booking status, reminders and announcements;
- apply no-show restrictions and prevent fraud and abuse;
- answer support requests and resolve disputes;
- produce aggregated (anonymous) statistics to improve the service;
- comply with legal requirements (accounting, tax, requests from competent authorities).

2.2. The Operator does not sell personal data to third parties for advertising.

## 3. Sharing with clubs and third parties

3.1. The club you book with sees the data needed to fulfil the booking: your name, phone number, booking details, payment status, and for card transfers the payer's name, last 4 card digits and receipt image.

3.2. Payment systems receive the data required to process payments.

3.3. Telegram (code delivery via the bot) and push notification services (Firebase Cloud Messaging) receive only the minimum data needed to deliver messages.

3.4. Data is disclosed to competent public authorities where required by law.

## 4. Storage location (localization)

4.1. In accordance with Article 27¹ of Law ZRU-547, personal data of citizens of the Republic of Uzbekistan is collected, systematised and stored on servers located in the Republic of Uzbekistan, and the personal data databases are registered in the State Register of Personal Data Databases.

4.2. Cross-border transfers (for example, when delivering messages via Telegram or push services) take place only on the conditions established by law and to the extent necessary to provide the service.

## 5. Retention

5.1. Account data — while the account is active and for up to 30 days after deletion.

5.2. Booking and payment records — for the period required by accounting and tax law (up to 5 years), after which they are anonymised or deleted.

5.3. Receipt images — up to 1 year after the payment is confirmed or rejected (to resolve disputes).

5.4. Device tokens — deleted when you sign out or when the token becomes invalid.

5.5. Audit and security logs — up to 1 year.

## 6. Security

6.1. The Operator applies organisational and technical safeguards: encrypted connections (HTTPS), role-based access control, each club sees only its own customers' data, passwords stored as hashes, and important actions recorded in an audit log.

6.2. Confirmation codes, tokens and passwords are never written to logs.

## 7. Your rights

7.1. You have the right to:
- know whether your data is processed and obtain a copy;
- correct inaccurate data (in your profile or by request);
- request deletion of your account and data (except records the law requires us to keep);
- withdraw consent (which may limit your ability to use the service);
- disable notifications and location access at any time;
- lodge a complaint with the competent authority or a court.

7.2. Requests can be sent to [Aloqa email] or via the "Support" section of the Platform and are handled within the period set by law.

## 8. Cookies and local storage

8.1. The website stores your sign-in state and language preference in the browser's local storage. We do not use advertising tracking cookies.

## 9. Children

9.1. The Platform is not intended for persons under 16 without parental consent. If we learn that such data was collected without consent, we will delete it.

## 10. Changes

10.1. A new version of this policy takes effect when published on the Platform. Customers are notified of material changes via the app or website.

## 11. Contacts

- **Operator:** [Kompaniya nomi]
- **TIN:** [STIR]
- **Address:** [Yuridik manzil]
- **Email:** [Aloqa email]
- **Phone:** [Telefon]
`,
  },
};
