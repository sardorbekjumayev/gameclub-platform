"use client";

import { formatDateTime, type Me } from "@gc/types";
import { CalendarDays, ChevronRight, Gamepad2, Heart, LifeBuoy, type LucideIcon, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Field, Input, Select, Spinner } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import type { NotificationPrefs } from "@/lib/types";

type DeviceSession = { id: string; ip: string | null; created_at: string; device_info: { platform?: string; user_agent?: string } | null };

function Profile() {
  const { me, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !me) router.replace("/login");
  }, [loading, me, router]);

  if (loading || !me) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return <ProfileForm me={me} />;
}

function ProfileForm({ me }: { me: Me }) {
  const { reload, signOut } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const errorText = useErrorText();
  const router = useRouter();
  const welcome = useSearchParams().get("welcome");
  const [form, setForm] = useState({ first_name: me.first_name ?? "", last_name: me.last_name ?? "", email: me.email ?? "", language: me.language });
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSessions = useCallback(() => {
    session
      .get<DeviceSession[]>("/auth/sessions")
      .then((r) => setSessions(r.data))
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await session.patch<Me>("/users/me", { ...form, email: form.email || null });
      setLocale(form.language as Me["language"]);
      await reload();
      setMsg({ tone: "success", text: t("common.saved") });
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[26px] font-bold">{t("profile.title")}</h1>
        <Button
          variant="secondary"
          onClick={async () => {
            await signOut();
            router.replace("/");
          }}
        >
          {t("auth.logout")}
        </Button>
      </div>
      {welcome && <Alert tone="info">{t("profile.welcomeNew")}</Alert>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {/* Tezkor bo'limlar — telefonda pastki menyuga sig'magan sahifalar shu yerda */}
      <nav className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line-soft bg-surface">
        <QuickLink href="/bookings" icon={CalendarDays} label={t("nav.bookings")} />
        <QuickLink href="/favorites" icon={Heart} label={t("nav.favorites")} />
        <QuickLink href="/my-rentals" icon={Gamepad2} label={t("rent.mine")} />
        <QuickLink href="/reviews" icon={Star} label={t("reviews.mine.title")} />
        <QuickLink href="/support" icon={LifeBuoy} label={t("support.title")} />
      </nav>
      <Card>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field label={t("profile.phone")}>
            <Input value={me.phone ?? ""} disabled />
          </Field>
          <Field label={t("profile.email")}>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={t("profile.firstName")}>
            <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} maxLength={80} />
          </Field>
          <Field label={t("profile.lastName")}>
            <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} maxLength={80} />
          </Field>
          <Field label={t("profile.language")}>
            <Select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Me["language"] })}>
              <option value="uz">O&apos;zbekcha</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={busy}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Card>
      <PrefsCard />
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{t("profile.sessions")}</h2>
          <Button
            variant="ghost"
            onClick={async () => {
              await session.post("/auth/logout-all");
              session.setTokens(null);
              await signOut();
              router.replace("/login");
            }}
          >
            {t("auth.logoutAll")}
          </Button>
        </div>
        {sessions === null ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-line-soft">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <div className="font-bold">{s.device_info?.platform ?? "—"}</div>
                  <div className="text-xs text-muted">
                    {formatDateTime(s.created_at, undefined, locale)} · {s.ip ?? ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await session.delete(`/auth/sessions/${s.id}`).catch(() => undefined);
                    loadSessions();
                  }}
                >
                  {t("profile.revoke")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-4 font-semibold transition hover:bg-surface-2">
      <Icon className="h-5 w-5 shrink-0 text-accent" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted" />
    </Link>
  );
}

const PREF_KEYS = ["reminders", "announcements", "telegram"] as const;

function PrefsCard() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    session.get<NotificationPrefs>("/users/me/notification-preferences").then(
      (r) => setPrefs(r.data),
      (e) => setError(errorText(e)),
    );
  }, [errorText]);

  async function toggle(key: (typeof PREF_KEYS)[number]) {
    if (!prefs) return;
    const prev = prefs;
    setPrefs({ ...prefs, [key]: !prefs[key] });
    try {
      const r = await session.patch<NotificationPrefs>("/users/me/notification-preferences", { [key]: !prev[key] });
      setPrefs(r.data);
    } catch (e) {
      setPrefs(prev);
      setError(errorText(e));
    }
  }

  return (
    <Card>
      <h2 className="mb-3 font-display text-lg font-bold">{t("notifications.prefs")}</h2>
      {error && <Alert>{error}</Alert>}
      {!prefs && !error && <Spinner />}
      {prefs && (
        <ul className="divide-y divide-line-soft">
          {PREF_KEYS.map((k) => (
            <li key={k} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="text-sm font-bold">{t(`notifications.pref.${k}` as never)}</div>
                <div className="text-xs text-muted">
                  {k === "telegram" && !prefs.telegram_linked ? t("notifications.telegramNotLinked") : t(`notifications.pref.${k}Hint` as never)}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs[k]}
                aria-label={t(`notifications.pref.${k}` as never)}
                onClick={() => toggle(k)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${prefs[k] ? "bg-accent" : "bg-surface-2"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${prefs[k] ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <Profile />
    </Suspense>
  );
}
