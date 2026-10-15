/** Mijoz tomoni API javoblari (docs/01-API.md §6.7–6.9). */
export type BranchCard = {
  id: string;
  name: string;
  slug: string;
  address: string;
  latitude: number;
  longitude: number;
  cover_url: string | null;
  club: { id: string; name: string; slug: string; logo_url: string | null };
  club_name: string;
  amenities: string[];
  rating_avg: number;
  rating_count: number;
  distance_m: number | null;
  is_open_now: boolean;
  open_until: string | null;
  price_from: number | null;
  device_types: string[];
  total_devices: number;
  free_devices: number;
};

export type WorkingHours = Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", { open: string; close: string }[]>;

export type BranchDetail = {
  id: string;
  club_id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  description: string | null;
  cover_url: string | null;
  images: string[];
  amenities: string[];
  timezone: string;
  working_hours: WorkingHours;
  status: string;
  booking_settings: { slot_minutes: number; max_advance_days: number; hold_minutes: number; allow_specific_device: boolean; allow_category_booking: boolean };
  rating_avg: number;
  rating_count: number;
  club: { id: string; name: string; slug: string; logo_url: string | null; description: string | null; phone: string | null; telegram: string | null; instagram: string | null; website?: string | null; rules?: string | null; amenities?: string[] };
  cancellation_policy?: CancellationPolicy;
  payment_options?: { card_transfer: boolean; pay_at_club: boolean };
  rooms?: { id: string; name: string; type: string; capacity: number | null; description: string | null }[];
  device_types?: { type: string; count: number }[];
  is_open?: boolean;
  open_until?: string | null;
  min_price_per_hour?: number | null;
};

/** Klub bekor qilish siyosati (docs/02-DATABASE.md §5) — bron paytida snapshot qilinadi. */
export type CancellationPolicy = {
  rules: { min_minutes_before_start: number; refund_percent: number }[];
  no_show_refund_percent?: number;
  free_cancel_minutes_before?: number;
  platform_fee_refundable?: boolean;
};

export type Slot = { start_at: string; available_count: number };
export type Slots = { date: string; timezone: string; slot_minutes: number; total_devices: number; slots: Slot[] };

export type AvailDevice = {
  layout?: { x: number; y: number } | null;
  id: string;
  name: string;
  type: string;
  specs: Record<string, string> | null;
  room: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  status: "AVAILABLE" | "BUSY" | "UNAVAILABLE" | string;
  price_quote: { amount: number; tariff_name: string; regular_amount?: number | null } | null;
};
export type AvailRoom = {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  grid_cols: number;
  grid_rows: number;
  tariff: { id: string; name: string; price_per_hour: number } | null;
  price_from: number | null;
  total_count: number;
  available_count: number;
  decor?: { kind: "ENTRANCE" | "CASHIER" | "WALL" | "AISLE" | "TV" | "WC"; x: number; y: number }[];
  together?: Record<string, { device_ids: string[]; adjacent: boolean } | null>;
};

export type Availability = { rooms?: AvailRoom[]; start_at: string; end_at: string; within_working_hours: boolean; hold_minutes: number; devices: AvailDevice[] };

/** Paket narx (GET /branches/:id/packages): qat'iy davomiylik + narx; regular_amount — oddiy soatlik narx (tejash uchun). */
export type BranchPackage = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  regular_amount: number;
  days_of_week: number[];
  start_time: string | null;
  end_time: string | null;
  /** Qaysi tarif (xona/kategoriya) uchun — bir xil nomli paketlarni ajratish */
  tariff: { id: string; name: string };
};

/** Bron paytidagi paket (snapshot). */
export type BookingPackage = { id: string; name: string; duration_minutes: number; price: number };

export type Tariff = { id: string; name: string; device_type: string | null; price_per_hour: number; rules: { kind: string; days_of_week: number[]; start_time: string; end_time: string; price_per_hour: number }[] };

export type Review = { id: string; rating: number; text: string | null; reply_text: string | null; created_at: string; author: string | null };

export type BookingStatus = "PENDING_PAYMENT" | "CONFIRMED" | "CHECKED_IN" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "NO_SHOW" | "EXPIRED";

export type BookingListItem = {
  id: string;
  code: string;
  status: BookingStatus;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  total_amount: number;
  paid_amount: number;
  payment_status: string;
  hold_expires_at: string | null;
  branch: { id: string; name: string; address: string; timezone: string; club: { id: string; name: string; logo_url: string | null } };
  devices: { id: string; name: string; type: string }[];
};

export type BookingPayment = {
  id: string;
  amount: number;
  method: "ONLINE_CARD" | "WALLET" | "CASH" | "TERMINAL" | "CARD_TRANSFER" | string;
  provider: string | null;
  provider_payload: { payer_name?: string; payer_card_last4?: string; card_last4?: string } | null;
  status: string;
  paid_at: string | null;
  refunded_amount: number;
  failed_reason: string | null;
  created_at: string;
};

export type BookingDetail = Omit<BookingListItem, "devices"> & {
  /** VIP (ochiq vaqt): tugash vaqti yo'q — summa operator yopganda hisoblanadi */
  is_open?: boolean;
  /** Paketli bron (masalan, "3 soat") — bron paytidagi shartlar */
  package?: BookingPackage | null;
  subtotal_amount: number;
  discount_amount: number;
  amount_due: number;
  cancellation_policy?: CancellationPolicy;
  /** Hozir bekor qilinsa qaytariladigan foiz va summa (paid_amount bo'yicha) */
  refund_preview?: { percent: number; amount: number } | null;
  /** Klub kartasiga o'tkazma (faqat to'lanmagan qism bo'lsa) */
  transfer?: { card_number: string; card_holder: string | null; amount: number; pending: BookingPayment | null; rejected: BookingPayment | null } | null;
  payments?: BookingPayment[];
  can_cancel: boolean;
  can_review: boolean;
  can_reschedule: boolean;
  reschedule_count?: number;
  refund_amount: number | null;
  cancellation_reason: string | null;
  price_snapshot: { payment_mode?: "ONLINE" | "AT_CLUB" } | null;
  items: { id: string; device_id: string; price_amount: number; start_at: string; end_at: string; device: { id: string; name: string; type: string; room: { name: string } | null } | null }[];
  review: { id: string; rating: number; text: string | null; reply_text: string | null; status: string; created_at: string; can_edit: boolean } | null;
  club: { id: string; name: string; phone: string | null; logo_url?: string | null };
  branch: BookingListItem["branch"] & { latitude: number; longitude: number; phone: string | null };
  server_time: string;
};

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  channels: string[];
  read_at: string | null;
  created_at: string;
};

export type NotificationPrefs = { telegram: boolean; push: boolean; reminders: boolean; announcements: boolean; telegram_linked: boolean };

export type Favorite = {
  branch_id: string;
  created_at: string;
  branch: {
    id: string;
    name: string;
    slug: string;
    address: string;
    cover_url: string | null;
    latitude: number;
    longitude: number;
    rating_avg: number;
    rating_count: number;
    status: string;
    club: { id: string; name: string; logo_url: string | null; status: string };
  };
};

export type PaymentProvider = { code: "DEMO" | "PAYME" | "CLICK" | string; name?: string };

/** GET /reviews/mine — xom `reviews` qatori */
export type MyReview = { id: string; booking_id: string; rating: number; text: string | null; reply_text: string | null; replied_at: string | null; status: string; created_at: string; branch_name: string; club_name: string; can_edit: boolean };

export const RENTAL_TYPES = ["PS5", "PS4", "XBOX", "NINTENDO_SWITCH", "VR", "OTHER"] as const;
export type RentalStatus = "REQUESTED" | "CONFIRMED" | "ACTIVE" | "RETURNED" | "CANCELLED" | "REJECTED" | "EXPIRED";

export type RentalItem = {
  id: string;
  branch_id: string;
  name: string;
  type: string;
  description: string | null;
  image_url: string | null;
  includes: string[];
  games: string[];
  quantity: number;
  price_per_hour: number | null;
  price_per_day: number | null;
  min_hours: number;
  max_days: number;
  deposit_amount: number;
  delivery_available: boolean;
  delivery_fee: number;
  requirements: string | null;
  available_now: number;
  branch: {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    phone: string | null;
    timezone: string;
    club: { id: string; name: string; logo_url: string | null; phone: string | null };
    is_open?: boolean;
    open_until?: string | null;
  };
};

export type RentalQuote = {
  start_at: string;
  end_at: string;
  unit_price: number;
  subtotal: number;
  delivery_fee: number;
  total: number;
  deposit: number;
  available_units: number;
  is_available: boolean;
};

export type RentalOrder = {
  id: string;
  code: string;
  status: RentalStatus;
  quantity: number;
  rate_unit: "HOUR" | "DAY";
  units: number;
  start_at: string;
  end_at: string;
  unit_price: number;
  subtotal_amount: number;
  delivery_fee_amount: number;
  late_fee_amount: number;
  total_amount: number;
  paid_amount: number;
  payment_status: string;
  deposit_amount: number;
  deposit_status: "NONE" | "HELD" | "RETURNED" | "KEPT";
  fulfillment: "PICKUP" | "DELIVERY";
  delivery_address: string | null;
  contact_phone: string | null;
  notes: string | null;
  cancel_reason: string | null;
  confirmed_at: string | null;
  handed_over_at: string | null;
  returned_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  item_snapshot: { name: string; type: string; image_url: string | null };
  is_overdue: boolean;
  overdue_minutes: number;
  branch: { id: string; name: string; address: string; timezone: string; latitude?: number; longitude?: number; phone?: string | null; club: { id: string; name: string; logo_url: string | null; phone?: string | null } } | null;
  item?: { id: string; name: string; type: string; image_url: string | null; includes: string[]; games: string[]; requirements: string | null };
  amount_due?: number;
  can_cancel?: boolean;
};

export const TICKET_TYPES = ["SUGGESTION", "REQUEST", "COMPLAINT", "QUESTION", "BUG", "PAYMENT", "OTHER"] as const;
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type SupportMessage = { id: string; sender_id: string; body: string; is_staff: boolean; created_at: string };
export type SupportTicket = {
  id: string;
  type: (typeof TICKET_TYPES)[number];
  subject: string;
  status: TicketStatus;
  awaiting_reply: boolean;
  last_message_at: string;
  created_at: string;
  club_name: string | null;
  _count?: { messages: number };
};
export type SupportTicketDetail = SupportTicket & { can_reply: boolean; messages: SupportMessage[] };
