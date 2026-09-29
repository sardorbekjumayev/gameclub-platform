"use client";

import type { Me } from "@gc/types";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";

export default function ProfilePage() {
  const { me, reload } = useAuth();
  const { t, setLocale } = useI18n();
  const errorText = useErrorText();
  const [form, setForm] = useState(() => ({
    first_name: me?.first_name ?? "",
    last_name: me?.last_name ?? "",
    email: me?.email ?? "",
    language: me?.language ?? ("uz" as Me["language"]),
  }));
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<"profile" | "password" | null>(null);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy("profile");
    setMsg(null);
    try {
      await session.patch<Me>("/users/me", { ...form, email: form.email || null });
      setLocale(form.language as Me["language"]);
      await reload();
      setMsg({ tone: "success", text: t("common.saved") });
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    setMsg(null);
    try {
      await session.post("/auth/password", { password });
      setPassword("");
      setMsg({ tone: "success", text: t("common.saved") });
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("profile.title")}</h1>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <form onSubmit={saveProfile} className="grid gap-4 sm:grid-cols-2">
          <Field label={t("profile.firstName")}>
            <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} maxLength={80} />
          </Field>
          <Field label={t("profile.lastName")}>
            <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} maxLength={80} />
          </Field>
          <Field label={t("profile.email")}>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={t("profile.language")}>
            <Select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Me["language"] })}>
              <option value="uz">O&apos;zbekcha</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" loading={busy === "profile"}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <form onSubmit={savePassword} className="space-y-4">
          <Field label={t("profile.password")} hint={t("profile.passwordHint")}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete="new-password" required />
          </Field>
          <Button type="submit" variant="secondary" loading={busy === "password"}>
            {t("profile.changePassword")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
