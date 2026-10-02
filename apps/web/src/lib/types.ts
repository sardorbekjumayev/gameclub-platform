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
  club: { id: string; name: string; slug: string; logo_url: string | null; description: string | null; phone: string | null; telegram: string | null; instagram: string | null; rules?: string | null; settings?: { allow_pay_at_club?: boolean } | null };
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
  price_quote: { amount: number; tariff_name: string } | null;
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

export type BookingDetail = Omit<BookingListItem, "devices"> & {
  amount_due: number;
  can_cancel: boolean;
  can_review: boolean;
  can_reschedule: boolean;
  reschedule_count?: number;
  refund_amount: number | null;
  cancellation_reason: string | null;
  price_snapshot: { payment_mode?: "ONLINE" | "AT_CLUB" } | null;
  items: { id: string; device_id: string; price_amount: number; start_at: string; end_at: string; device: { id: string; name: string; type: string; room: { name: string } | null } | null }[];
  review: { id: string; rating: number; text: string | null; reply_text: string | null; status: string; created_at: string; can_edit: boolean } | null;
  club: { id: string; name: string; phone: string | null };
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
