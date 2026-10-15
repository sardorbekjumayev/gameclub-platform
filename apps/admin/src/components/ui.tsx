"use client";

import type { LucideIcon } from "lucide-react";
import { forwardRef } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-9 rounded-[10px] px-3.5 text-[13px]",
        size === "md" && "h-11 rounded-xl px-5 text-sm",
        size === "lg" && "h-[54px] rounded-[14px] px-6 text-base",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-hover",
        variant === "secondary" && "border border-line bg-surface font-semibold text-fg hover:border-muted/60",
        variant === "ghost" && "font-semibold text-muted hover:bg-surface-2 hover:text-fg",
        variant === "danger" && "border border-danger/60 font-semibold text-danger-soft hover:bg-danger/10",
        className,
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

const fieldBase =
  "rounded-[14px] border border-line bg-surface px-4 text-[15px] text-fg outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={cx("h-12 w-full", fieldBase, className)} />;
});

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx("h-12 pr-8", fieldBase, className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted/80">{hint}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx("rounded-[18px] bg-surface p-5", className)}>{children}</div>;
}

/** Katta raqamli ko'rsatkich kartasi (admin live panel uslubi). */
export function Stat({ label, value, accent, icon: Icon, hint }: { label: string; value: React.ReactNode; accent?: boolean; icon?: LucideIcon; hint?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line-soft bg-surface p-[18px]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] text-muted">{label}</div>
        {Icon && (
          <span className={cx("grid h-8 w-8 place-items-center rounded-lg", accent ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className={cx("mt-1.5 font-display text-2xl font-bold tabular-nums", accent && "text-accent")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Tezkor amal plitkasi (dashboard): ikona + sarlavha + izoh. */
export function ActionTile({ icon: Icon, title, desc, tone = "default" }: { icon: LucideIcon; title: string; desc?: string; tone?: "default" | "accent" }) {
  return (
    <div
      className={cx(
        "group flex h-full items-start gap-3 rounded-2xl border p-4 transition",
        tone === "accent" ? "border-accent/40 bg-accent/10 hover:bg-accent/15" : "border-line-soft bg-surface hover:border-line hover:bg-surface-2",
      )}
    >
      <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone === "accent" ? "bg-accent text-on-accent" : "bg-surface-3 text-accent")}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="font-bold">{title}</div>
        {desc && <div className="mt-0.5 text-[13px] leading-snug text-muted">{desc}</div>}
      </div>
    </div>
  );
}

export function Heading({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h1 className={cx("font-display text-[26px] font-bold leading-tight", className)}>{children}</h1>;
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "error" && "border-danger/40 bg-danger/10 text-danger-soft",
        tone === "success" && "border-accent/40 bg-accent/10 text-accent",
        tone === "info" && "border-line bg-surface-2 text-fg",
      )}
    >
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin text-accent", className ?? "h-5 w-5")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "red" | "amber" | "violet" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold",
        tone === "neutral" && "border-line text-muted",
        tone === "green" && "border-accent/40 bg-accent/10 text-accent",
        tone === "red" && "border-danger/40 bg-danger/10 text-danger-soft",
        tone === "amber" && "border-warn/40 bg-warn/10 text-warn",
        tone === "violet" && "border-line bg-surface-3 text-fg",
      )}
    >
      {children}
    </span>
  );
}

/** Filtr "chip" (pill) — maketlardagi "Hozir ochiq / PS5 / VIP". */
export function Chip({ active, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "h-9 rounded-full px-3.5 text-[13px] transition",
        active ? "bg-accent font-bold text-on-accent" : "border border-line bg-surface font-semibold text-fg hover:border-muted/60",
        className,
      )}
    />
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("font-display text-[22px] font-bold tracking-wide text-accent", className)}>
      ZON<span className="text-fg">UP</span>
    </span>
  );
}

/** Pastdan chiquvchi (mobil) / markaziy (desktop) modal oyna. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[20px] bg-bg p-5 shadow-2xl sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button className="rounded-lg px-2 text-2xl leading-none text-muted hover:text-fg" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
