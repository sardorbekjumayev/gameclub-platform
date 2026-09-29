"use client";

import { formatDateTime, type Me } from "@gc/types";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Field, Input, Select, Spinner } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";

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
        <h1 className="text-2xl font-semibold">{t("profile.title")}</h1>
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
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t("profile.sessions")}</h2>
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
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <div className="font-medium">{s.device_info?.platform ?? "—"}</div>
                  <div className="text-xs text-zinc-500">
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

export default function ProfilePage() {
  return (
    <Suspense>
      <Profile />
    </Suspense>
  );
}
