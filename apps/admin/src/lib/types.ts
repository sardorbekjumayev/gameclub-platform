/** Phase 2 API javoblari (docs/01-API.md §6.1–6.3). OpenAPI generatsiyasi kengaytirilguncha qo'lda. */
export type ClubStatus = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "REJECTED" | "SUSPENDED" | "CLOSED";

export type MyClub = {
  id: string;
  name: string;
  slug: string;
  status: ClubStatus;
  logo_url: string | null;
  rejection_reason: string | null;
  suspended_reason: string | null;
  branches: { id: string; name: string; status: string }[];
  my_roles: { role: string; branch_id: string | null }[];
};

export type ClubDocument = { id: string; type: string; file_url: string; status: string; note?: string | null; created_at: string };

export type Club = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  telegram: string | null;
  instagram: string | null;
  website: string | null;
  logo_url: string | null;
  cover_url: string | null;
  rules: string | null;
  status: ClubStatus;
  rejection_reason: string | null;
  suspended_reason: string | null;
  created_at: string;
  owner?: { id: string; phone: string | null; email: string | null; first_name: string | null; last_name: string | null };
  documents?: ClubDocument[];
  branches?: Branch[];
  stats?: { bookings: number; gmv: number };
  _count?: { branches: number; documents: number };
};

export type Branch = {
  id: string;
  club_id: string;
  name: string;
  slug: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  status: string;
  is_open_now?: boolean;
};

export type Room = { id: string; branch_id: string; name: string; type: string; capacity: number | null; status: string; position: number | null; grid_cols: number; grid_rows: number; decor?: { kind: "ENTRANCE" | "CASHIER" | "WALL" | "AISLE" | "TV" | "WC"; x: number; y: number }[] };

export type StaffRow = {
  id: string;
  role: string;
  branch_id: string | null;
  branch_name: string | null;
  created_at: string;
  user: { id: string; phone: string | null; email: string | null; first_name: string | null; last_name: string | null; status: string; last_login_at: string | null };
};

export type Invitation = {
  id: string;
  role: string;
  branch_id: string | null;
  phone_or_email: string;
  status: string;
  expires_at: string;
  created_at: string;
  invite_url?: string;
};

export const STAFF_ROLES = ["CLUB_ADMIN", "BRANCH_ADMIN", "OPERATOR"] as const;
export const needsBranch = (role: string) => role === "BRANCH_ADMIN" || role === "OPERATOR";

// ---- Phase 3: qurilmalar va tariflar ----
export const DEVICE_TYPES = ["PC", "PS5", "PS4", "XBOX", "RACING_SIMULATOR", "OTHER"] as const;

export type DeviceCategory = { id: string; branch_id: string; name: string; device_type: string; description: string | null; position: number };

/** Zal sxemasidagi joy: grid katak (0..100), PUT /branches/:id/layout. */
export type DeviceLayout = { x: number; y: number };

export type Device = {
  id: string;
  branch_id: string;
  room_id: string | null;
  category_id: string | null;
  name: string;
  type: string;
  specs: { cpu?: string; gpu?: string; ram?: string; monitor?: string; [k: string]: unknown } | null;
  operational_status: "ACTIVE" | "MAINTENANCE" | "DISABLED";
  position_order: number | null;
  layout?: DeviceLayout | null;
  room: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
};

export type Maintenance = {
  id: string;
  device_id: string;
  title: string;
  description: string | null;
  status: "OPEN" | "IN_PROGRESS" | "DONE";
  created_at: string;
  device?: { id: string; name: string };
};

export const RULE_KINDS = ["STANDARD", "WEEKEND", "NIGHT", "HOLIDAY"] as const;

export type TariffRule = { id?: string; days_of_week: number[]; start_time: string; end_time: string; price_per_hour: number; kind: string; date?: string | null };

export type Tariff = {
  id: string;
  name: string;
  device_type: string | null;
  category_id: string | null;
  room_id: string | null;
  device_id: string | null;
  price_per_hour: number;
  min_minutes: number | null;
  max_minutes: number | null;
  priority: number;
  is_active: boolean;
  rules: TariffRule[];
  packages?: TariffPackage[];
};

/** Paket: qat'iy davomiylik + qat'iy narx (masalan, 3 soat — 30 000). */
export type TariffPackage = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  days_of_week: number[];
  start_time: string | null;
  end_time: string | null;
  is_active: boolean;
  /** GET /branches/:id/packages javobida */
  tariff?: { id: string; name: string };
};

export type QuoteSegment = { from: string; to: string; rule: string; price_per_hour: number; minutes: number; amount: number; package_id?: string };
export type Quote = {
  items: { device_id: string; name: string; tariff_name: string; amount: number; segments: QuoteSegment[]; package?: { id: string; name: string; regular_amount: number } }[];
  subtotal: number;
  discount: number;
  total: number;
};

// ---- Phase 7: live board, sessiyalar, kassa ----
export type Occupancy = "AVAILABLE" | "RESERVED" | "OCCUPIED" | "UNAVAILABLE";

export type LiveDevice = {
  id: string;
  name: string;
  type: string;
  room: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  layout?: DeviceLayout | null;
  operational_status: string;
  occupancy: Occupancy;
  session: {
    id: string;
    status: "WAITING" | "ACTIVE" | "PAUSED";
    started_at: string;
    expected_end_at: string | null;
    booking_id: string | null;
    booking_code: string | null;
    customer_name: string | null;
    remaining_seconds: number | null;
    amount_due: number;
    /** VIP / ochiq vaqt: tugash vaqti yo'q, yakunda haqiqiy vaqt bo'yicha to'lanadi */
    is_open?: boolean;
    must_end_by?: string | null;
    paused_at?: string | null;
    total_paused_seconds?: number;
    accrued_amount?: number | null;
  } | null;
  next_booking: { id: string; code: string; status: string; start_at: string; end_at: string; customer_name: string | null } | null;
};

export type LiveSnapshot = {
  rooms?: Room[];
  branch: { id: string; name: string; club_id: string; club_name: string; timezone: string };
  stats: { today_revenue: number; active_sessions: number; free_devices: number; upcoming_bookings: number; total_devices: number };
  devices: LiveDevice[];
  upcoming: { booking_id: string; code: string; status: string; device_id: string; start_at: string; end_at: string; customer_name: string | null }[];
  open_shift: { id: string; opened_at: string } | null;
  server_time: string;
};

export type ShiftReport = {
  id: string;
  status: "OPEN" | "CLOSED";
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash_counted: number | null;
  difference: number | null;
  branch_name?: string;
  totals: { cash_in: number; terminal_in: number; cash_refunds: number; payments_count: number; expected_cash: number };
};

// ---- Tarif rejalari va obunalar ----
export type PlanLimits = { branches: number | null; devices: number | null; staff: number | null; analytics: boolean; online_booking: boolean; api_access: boolean; pc_agent: boolean };
export type Plan = { id: string; code: string; name: string; price_per_month: number; limits: PlanLimits; is_active: boolean; active_clubs?: number; is_trial_plan?: boolean };
export type Subscription = { id: string; status: string; current_period_start: string; current_period_end: string; trial_ends_at: string | null; plan: Plan };
export type ClubSubscription = { subscription: Subscription | null; usage: { branches: number; devices: number; staff: number } };

/** Bekor qilish/kelmaslik bo'yicha qaytarish siyosati (docs/02-DATABASE.md §5 cancellation_policy). */
export type CancellationPolicy = {
  free_cancel_minutes_before: number;
  rules: { min_minutes_before_start: number; refund_percent: number }[];
  platform_fee_refundable: boolean;
  no_show_refund_percent: number;
};

export type ClubPaymentSettings = {
  cancellation_policy: CancellationPolicy;
  settings: { allow_pay_at_club?: boolean } & Record<string, unknown>;
  transfer_card: { number: string; holder: string | null } | null;
};

export type TransferPayload = { payer_name?: string; payer_card_last4?: string; card_last4?: string };

export type PaymentRow = {
  id: string;
  booking_id: string | null;
  booking_code: string | null;
  club_id: string;
  branch_id: string | null;
  amount: number;
  method: string;
  provider: string | null;
  provider_payload: TransferPayload | null;
  status: string;
  failed_reason: string | null;
  created_at: string;
};

export type RefundRow = {
  id: string;
  amount: number;
  status: string;
  reason: string | null;
  created_at: string;
  payment: { id: string; method: string; provider: string | null; provider_payload: TransferPayload | null; branch_id: string | null } | null;
  booking: { id: string; code: string; start_at: string } | null;
  customer: { id: string; phone: string; first_name: string | null; last_name: string | null } | null;
};

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
  status: "ACTIVE" | "INACTIVE";
  position: number;
  out_now: number;
  available_now: number;
  requested_count: number;
  open_count: number;
};

export type Rental = {
  id: string;
  code: string;
  item_id: string;
  branch_id: string;
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
  handed_over_at: string | null;
  returned_at: string | null;
  created_at: string;
  item_snapshot: { name: string; type: string; image_url: string | null };
  is_overdue: boolean;
  overdue_minutes: number;
  suggested_late_fee: number;
  branch: { id: string; name: string; timezone: string } | null;
  customer?: { id: string; phone: string | null; first_name: string | null; last_name: string | null } | null;
};

/** Promo kod (docs/01-API.md §6.12). Pul — tiyin. `club` — faqat super admin ro'yxatida. */
export type Promotion = {
  id: string;
  club_id: string | null;
  club?: { id: string; name: string } | null;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  max_discount_amount: number | null;
  min_order_amount: number | null;
  usage_limit: number | null;
  per_user_limit: number | null;
  used_count: number;
  starts_at: string | null;
  ends_at: string | null;
  funded_by: "CLUB" | "PLATFORM";
  is_active: boolean;
  created_at: string;
};
