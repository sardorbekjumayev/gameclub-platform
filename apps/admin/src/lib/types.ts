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
};

export type QuoteSegment = { from: string; to: string; rule: string; price_per_hour: number; minutes: number; amount: number };
export type Quote = {
  items: { device_id: string; name: string; tariff_name: string; amount: number; segments: QuoteSegment[] }[];
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
