/** Phase 9 analytics / payouts / reviews API javob turlari (pul — tiyin). */
export type Overview = {
  range: { from: string; to: string };
  gmv: number;
  discounts: number;
  collected: number;
  refunds: number;
  net: number;
  commission: number;
  club_revenue: number;
  payments_count: number;
  bookings_total: number;
  bookings_confirmed: number;
  bookings_by_status: Record<string, number>;
  avg_booking_value: number;
  cancellation_rate: number;
  no_show_rate: number;
  occupancy: { busy_minutes: number; capacity_minutes: number; rate: number };
  customers: { unique: number; returning: number; new: number; repeat_rate: number };
  active_sessions: number;
  previous?: { gmv: number; collected: number; net: number; bookings_confirmed: number };
};

export type RevenuePoint = { date: string; collected: number; commission: number; refunds: number; gmv: number; bookings: number; payments: number; net: number };

export type PlatformOverview = Omit<Overview, "occupancy" | "customers" | "active_sessions" | "previous"> & {
  clubs_by_status: Record<string, number>;
  users_by_type: Record<string, number>;
  new_customers: number;
  active_branches: number;
  devices: number;
  queues: { pending_clubs: number; open_tickets: number; reviews_to_moderate: number };
  top_clubs: { club_id: string; name: string | null; collected: number; commission: number }[];
};

export type GrowthPoint = { date: string; bookings: number; gmv: number; new_users: number };

export type PayoutStatus = "PENDING" | "PAID" | "CANCELLED";
export type Payout = {
  id: string;
  club_id: string;
  club_name: string | null;
  period_start: string;
  period_end: string;
  gross_amount: number;
  commission_amount: number;
  refunds_amount: number;
  net_amount: number;
  status: PayoutStatus;
  paid_at: string | null;
  reference: string | null;
  created_at: string;
};

export type Review = {
  id: string;
  user_id: string;
  club_id: string;
  branch_id: string;
  rating: number;
  text: string | null;
  status: "VISIBLE" | "HIDDEN" | "PENDING_MODERATION";
  reply_text: string | null;
  replied_at: string | null;
  reported_count: number;
  moderation_note: string | null;
  created_at: string;
  author: string | null;
  club_name?: string | null;
};
