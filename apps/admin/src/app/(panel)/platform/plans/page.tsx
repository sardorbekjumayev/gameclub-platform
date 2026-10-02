"use client";

import { formatMoney, parseSom, tiyinToSomInput } from "@gc/types";
import { useState } from "react";
import { Empty, LoadState } from "@/components/status";
import { Alert, Badge, Button, Card, Field, Heading, Input, Select, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { Plan, PlanLimits } from "@/lib/types";
import { idemKey, useApi } from "@/lib/use-api";

const NUM_LIMITS = ["branches", "devices", "staff"] as const;
const FEATURES = ["online_booking", "analytics", "api_access", "pc_agent"] as const;
const EMPTY_LIMITS: PlanLimits = { branches: 1, devices: 10, staff: 3, analytics: false, online_booking: true, api_access: false, pc_agent: false };

/** Super admin: klublar uchun tarif rejalari (docs/01-API.md §6.18). */
export default function PlansPage() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const plans = useApi<Plan[]>("/admin/plans");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function run(fn: () => Promise<unknown>, success = t("common.saved")) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: success });
      setEditing(null);
      plans.reload();
      return true;
    } catch (e) {
      const reason = (e as { details?: { reason?: string } }).details?.reason;
      setMsg({ tone: "error", text: reason ? t(`plan.err.${reason}` as never) : errorText(e) });
      return false;
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Heading>{t("plan.title")}</Heading>
          <p className="mt-1 text-sm text-muted">{t("plan.subtitle")}</p>
        </div>
        {editing !== "new" && <Button onClick={() => setEditing("new")}>{t("plan.new")}</Button>}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {plans.data && <TrialSettings plans={plans.data} onSaved={plans.reload} />}
      {editing === "new" && (
        <Card>
          <PlanForm onCancel={() => setEditing(null)} onSubmit={(body) => run(() => session.post("/admin/plans", body, { "Idempotency-Key": idemKey() }))} />
        </Card>
      )}
      <LoadState loading={plans.loading} error={plans.error} onRetry={plans.reload} />
      {plans.data?.length === 0 && editing !== "new" && <Empty>{t("plan.empty")}</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.data?.map((p) =>
          editing === p.id ? (
            <Card key={p.id} className="md:col-span-2 xl:col-span-3">
              <PlanForm plan={p} onCancel={() => setEditing(null)} onSubmit={(body) => run(() => session.patch(`/admin/plans/${p.id}`, body))} />
            </Card>
          ) : (
            <Card key={p.id} className={cx("flex flex-col gap-4", !p.is_active && "opacity-60", p.is_trial_plan && "border border-accent")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-xl font-bold">{p.name}</span>
                    {!p.is_active && <Badge>{t("tariff.inactive")}</Badge>}
                    {p.is_trial_plan && <Badge tone="green">{t("plan.trialBadge")}</Badge>}
                  </div>
                  <div className="font-mono text-xs text-muted">{p.code}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl font-bold text-accent tabular-nums">{p.price_per_month === 0 ? t("plan.free") : formatMoney(p.price_per_month, locale)}</div>
                  <div className="text-xs text-muted">/{t("plan.month")}</div>
                </div>
              </div>
              <ul className="space-y-1.5 text-sm">
                {NUM_LIMITS.map((k) => (
                  <li key={k} className="flex justify-between">
                    <span className="text-muted">{t(`plan.limit.${k}` as never)}</span>
                    <b className="tabular-nums">{p.limits[k] === null ? t("plan.unlimited") : p.limits[k]}</b>
                  </li>
                ))}
                {FEATURES.map((k) => (
                  <li key={k} className="flex justify-between">
                    <span className="text-muted">{t(`plan.feature.${k}` as never)}</span>
                    <span className={p.limits[k] ? "text-accent" : "text-muted"}>{p.limits[k] ? "✓" : "—"}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3 text-sm">
                <span className="text-muted">{t("plan.activeClubs", { n: p.active_clubs ?? 0 })}</span>
                <span className="flex gap-3">
                  <button className="text-xs font-semibold text-muted hover:text-fg" onClick={() => setEditing(p.id)}>
                    {t("common.edit")}
                  </button>
                  <button className="text-xs font-semibold text-muted hover:text-fg" onClick={() => run(() => session.patch(`/admin/plans/${p.id}`, { is_active: !p.is_active }))}>
                    {p.is_active ? t("tariff.deactivate") : t("tariff.activate")}
                  </button>
                  <button
                    className="text-xs font-semibold text-danger-soft hover:underline"
                    onClick={() => confirm(t("plan.confirmDelete", { name: p.name })) && run(() => session.delete(`/admin/plans/${p.id}`), t("plan.deleted"))}
                  >
                    {t("common.delete")}
                  </button>
                </span>
              </div>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}

function TrialSettings({ plans, onSaved }: { plans: Plan[]; onSaved: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const trial = useApi<{ plan_id: string | null; days: number }>("/admin/plans/trial");
  const active = plans.filter((p) => p.is_active);
  const [planId, setPlanId] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pid = planId ?? trial.data?.plan_id ?? active[0]?.id ?? "";
  const d = days ?? String(trial.data?.days ?? 30);

  return (
    <Card className="space-y-3">
      <div className="font-display text-lg font-bold">{t("plan.trialTitle")}</div>
      <p className="text-sm text-muted">{t("plan.trialHint")}</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await session.put("/admin/plans/trial", { plan_id: pid, days: Number(d) });
            setMsg({ tone: "success", text: t("common.saved") });
            trial.reload();
            onSaved();
          } catch (err) {
            setMsg({ tone: "error", text: errorText(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t("plan.trialPlan")}>
          <Select value={pid} onChange={(e) => setPlanId(e.target.value)}>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("plan.trialDays")} hint={t("plan.trialDaysHint")}>
          <Input className="w-32" type="number" min={0} max={365} value={d} onChange={(e) => setDays(e.target.value)} required />
        </Field>
        <Button type="submit" variant="secondary" loading={busy} disabled={!pid}>
          {t("common.save")}
        </Button>
      </form>
    </Card>
  );
}

function PlanForm({ plan, onSubmit, onCancel }: { plan?: Plan; onSubmit: (b: Record<string, unknown>) => Promise<boolean>; onCancel: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(plan?.code ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [price, setPrice] = useState(plan ? tiyinToSomInput(plan.price_per_month) : "");
  const [limits, setLimits] = useState<PlanLimits>(plan?.limits ?? EMPTY_LIMITS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setNum = (k: (typeof NUM_LIMITS)[number], v: string | null) => setLimits((l) => ({ ...l, [k]: v === null ? null : Math.max(0, Number(v) || 0) }));

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const p = parseSom(price || "0");
        if (p === null) {
          setError(t("tariff.badPrice"));
          return;
        }
        setError(null);
        setBusy(true);
        await onSubmit({ ...(!plan && { code: code.toUpperCase() }), name, price_per_month: p, limits });
        setBusy(false);
      }}
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("plan.code")} hint={t("plan.codeHint")}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} disabled={!!plan} pattern="[A-Z][A-Z0-9_]{1,29}" required placeholder="STARTER" />
        </Field>
        <Field label={t("plan.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={60} required />
        </Field>
        <Field label={t("plan.price")} hint={t("tariff.somHint")}>
          <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="299000" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {NUM_LIMITS.map((k) => (
          <Field key={k} label={t(`plan.limit.${k}` as never)}>
            <div className="flex items-center gap-2">
              <Input type="number" min={0} value={limits[k] === null ? "" : String(limits[k])} onChange={(e) => setNum(k, e.target.value)} disabled={limits[k] === null} required={limits[k] !== null} />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={limits[k] === null} onChange={(e) => setNum(k, e.target.checked ? null : "1")} />
                {t("plan.unlimited")}
              </label>
            </div>
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        {FEATURES.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={limits[k]} onChange={(e) => setLimits((l) => ({ ...l, [k]: e.target.checked }))} />
            {t(`plan.feature.${k}` as never)}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {t("common.save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
