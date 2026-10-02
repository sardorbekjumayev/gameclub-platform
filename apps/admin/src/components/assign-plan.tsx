"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { Plan } from "@/lib/types";
import { idemKey, useApi } from "@/lib/use-api";

/** Super admin: klubga reja biriktirish (joriy obuna bekor qilinib, yangisi ochiladi). */
export function AssignPlan({ clubId, currentPlanId, onDone }: { clubId: string; currentPlanId: string | null; onDone: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const plans = useApi<Plan[]>("/admin/plans");
  const active = (plans.data ?? []).filter((p) => p.is_active);
  const [planId, setPlanId] = useState<string | null>(null);
  const [status, setStatus] = useState<"ACTIVE" | "TRIALING">("ACTIVE");
  const [days, setDays] = useState("30");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pid = planId ?? currentPlanId ?? active[0]?.id ?? "";

  return (
    <form
      className="space-y-3 border-t border-line-soft pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          await session.post(`/admin/clubs/${clubId}/subscription`, { plan_id: pid, status, days: Number(days) }, { "Idempotency-Key": idemKey() });
          setMsg({ tone: "success", text: t("plan.assigned") });
          onDone();
        } catch (err) {
          setMsg({ tone: "error", text: errorText(err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="text-sm font-bold">{t("plan.assign")}</div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("plan.plan")}>
          <Select value={pid} onChange={(e) => setPlanId(e.target.value)}>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("users.col.status")}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "TRIALING")}>
            <option value="ACTIVE">{t("status.ACTIVE")}</option>
            <option value="TRIALING">{t("status.TRIALING")}</option>
          </Select>
        </Field>
        <Field label={t("plan.days")}>
          <Input className="w-28" type="number" min={1} max={3660} value={days} onChange={(e) => setDays(e.target.value)} required />
        </Field>
        <Button type="submit" loading={busy} disabled={!pid}>
          {t("plan.assignBtn")}
        </Button>
      </div>
    </form>
  );
}
