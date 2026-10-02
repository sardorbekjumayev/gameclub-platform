"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/session";

/** Kirish talab qilinadigan sahifalar: kirmagan bo'lsa /login?next=... ga yo'naltiradi. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && !me) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, me, router, pathname]);
  if (loading || !me) return <Spinner className="mx-auto my-24 h-6 w-6" />;
  return <>{children}</>;
}

export const BOOKING_TONE: Record<string, "neutral" | "green" | "red" | "amber" | "violet"> = {
  PENDING_PAYMENT: "amber",
  CONFIRMED: "green",
  CHECKED_IN: "violet",
  ACTIVE: "violet",
  COMPLETED: "neutral",
  CANCELLED: "red",
  NO_SHOW: "red",
  EXPIRED: "neutral",
};
