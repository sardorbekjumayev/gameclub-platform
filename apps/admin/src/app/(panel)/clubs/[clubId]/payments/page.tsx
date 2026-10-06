"use client";

import { CreditCard, Plus, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ClubHeader } from "@/components/club-tabs";
import { TransferInbox } from "@/components/payments/transfer-inbox";
import { LoadState } from "@/components/status";
import { Alert, Badge, Button, Card, Chip, Field, Input, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { cardBrand, fmtCard, policyLines } from "@/lib/policy";
import { session, useAuth } from "@/lib/session";
import type { CancellationPolicy, ClubPaymentSettings } from "@/lib/types";
import { useApi } from "@/lib/use-api";

type Tier = { hours: string; percent: string };
type PolicyForm = { tiers: Tier[]; rest: string; noShow: string };

/** Tayyor shablonlar: soat → foiz; `rest` — undan kechroq bekor qilinsa. */
const PRESETS: Record<"soft" | "standard" | "strict", PolicyForm> = {
  soft: { tiers: [{ hours: "2", percent: "100" }, { hours: "0.5", percent: "50" }], rest: "0", noShow: "0" },
  standard: { tiers: [{ hours: "24", percent: "100" }, { hours: "3", percent: "50" }], rest: "0", noShow: "0" },
  strict: { tiers: [{ hours: "24", percent: "50" }], rest: "0", noShow: "0" },
};

function toForm(p: CancellationPolicy): PolicyForm {
  const rules = [...p.rules].sort((a, b) => b.min_minutes_before_start - a.min_minutes_before_start);
  const zero = rules.find((r) => r.min_minutes_before_start === 0);
  return {
    tiers: rules.filter((r) => r.min_minutes_before_start > 0).map((r) => ({ hours: String(r.min_minutes_before_start / 60), percent: String(r.refund_percent) })),
    rest: String(zero?.refund_percent ?? 0),
    noShow: String(p.no_show_refund_percent ?? 0),
  };
}

function toPolicy(f: PolicyForm): CancellationPolicy | null {
  const pct = (v: string) => (/^\d{1,3}$/.test(v) && Number(v) <= 100 ? Number(v) : null);
  const tiers = f.tiers.map((x) => ({ min: Math.round(Number(x.hours) * 60), pct: pct(x.percent) }));
  const rest = pct(f.rest);
  const noShow = pct(f.noShow);
  if (rest === null || noShow === null || tiers.some((x) => !(x.min > 0) || x.pct === null)) return null;
  if (new Set(tiers.map((x) => x.min)).size !== tiers.length) return null;
  const rules = [...tiers.map((x) => ({ min_minutes_before_start: x.min, refund_percent: x.pct! })), { min_minutes_before_start: 0, refund_percent: rest }].sort(
    (a, b) => b.min_minutes_before_start - a.min_minutes_before_start,
  );
  const free = rules.find((r) => r.refund_percent === 100)?.min_minutes_before_start ?? 0;
  return { free_cancel_minutes_before: free, rules, platform_fee_refundable: false, no_show_refund_percent: noShow };
}

/** Klub to'lov sozlamalari: o'tkazma kartasi, qaytarish siyosati, kelgan o'tkazmalar va qaytarishlar. */
export default function ClubPaymentsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t } = useI18n();
  const { can } = useAuth();
  const s = useApi<ClubPaymentSettings>(`/clubs/${clubId}/settings`);
  const showInbox = can("payments.create") || can("payments.refund");

  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      <LoadState loading={s.loading} error={s.error} onRetry={s.reload} />
      {s.data && (
        <>
          {!s.data.transfer_card && <Alert tone="info">{t("pay.noCardWarning")}</Alert>}
          <div className="grid gap-5 xl:grid-cols-2">
            <CardSection clubId={clubId} data={s.data} onSaved={s.setData} />
            <PolicySection clubId={clubId} data={s.data} onSaved={s.setData} />
          </div>
        </>
      )}
      {showInbox && <TransferInbox clubId={clubId} />}
    </div>
  );
}

function useSave(clubId: string, onSaved: (d: ClubPaymentSettings) => void) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  async function save(name: string, body: Record<string, unknown>) {
    setBusy(name);
    setMsg(null);
    try {
      onSaved((await session.patch<ClubPaymentSettings>(`/clubs/${clubId}/settings`, body)).data);
      setMsg({ tone: "success", text: t("common.saved") });
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }
  return { busy, msg, setMsg, save };
}

function CardSection({ clubId, data, onSaved }: { clubId: string; data: ClubPaymentSettings; onSaved: (d: ClubPaymentSettings) => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const editable = can("settings.update");
  const { busy, msg, setMsg, save } = useSave(clubId, onSaved);
  const [number, setNumber] = useState(fmtCard(data.transfer_card?.number ?? ""));
  const [holder, setHolder] = useState(data.transfer_card?.holder ?? "");
  const digits = number.replace(/\D/g, "");
  const brand = cardBrand(digits);
  const payAtClub = data.settings?.allow_pay_at_club !== false;

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-accent" />
        <div className="font-display text-lg font-bold">{t("pay.card.title")}</div>
      </div>
      <p className="text-sm text-muted">{t("pay.card.hint")}</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {/* Mijoz ko'radigan karta ko'rinishi */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-accent/25 via-surface-2 to-surface-2 p-5">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-widest text-muted">
          <span>{t("pay.card.preview")}</span>
          {brand && <Badge tone="violet">{brand}</Badge>}
        </div>
        <div className="mt-6 font-mono text-2xl font-bold tracking-widest">{number || "0000 0000 0000 0000"}</div>
        <div className="mt-2 text-sm font-semibold uppercase text-muted">{holder || t("pay.card.holderPh")}</div>
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (digits.length !== 16) {
            setMsg({ tone: "error", text: t("pay.card.invalid") });
            return;
          }
          save("card", { transfer_card: { number: digits, holder: holder.trim() } });
        }}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t("pay.card.number")}>
            <Input inputMode="numeric" autoComplete="off" value={number} onChange={(e) => setNumber(fmtCard(e.target.value))} placeholder="8600 0000 0000 0000" disabled={!editable} required />
          </Field>
          <Field label={t("pay.card.holder")}>
            <Input value={holder} onChange={(e) => setHolder(e.target.value.toUpperCase())} placeholder={t("pay.card.holderPh")} minLength={2} maxLength={80} disabled={!editable} required />
          </Field>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy === "card"}>
              {t("common.save")}
            </Button>
            {data.transfer_card && (
              <Button
                type="button"
                variant="danger"
                loading={busy === "remove"}
                onClick={() => {
                  if (!confirm(t("pay.card.removeConfirm"))) return;
                  setNumber("");
                  setHolder("");
                  save("remove", { transfer_card: null });
                }}
              >
                <Trash2 className="h-4 w-4" /> {t("pay.card.remove")}
              </Button>
            )}
          </div>
        )}
      </form>

      <label className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-accent)]"
          checked={payAtClub}
          disabled={!editable || busy === "payAtClub"}
          onChange={(e) => save("payAtClub", { settings: { ...data.settings, allow_pay_at_club: e.target.checked } })}
        />
        <span>
          <span className="font-semibold">{t("pay.payAtClub")}</span>
          <span className="block text-xs text-muted">{t("pay.payAtClubHint")}</span>
        </span>
      </label>
    </Card>
  );
}

function PolicySection({ clubId, data, onSaved }: { clubId: string; data: ClubPaymentSettings; onSaved: (d: ClubPaymentSettings) => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const editable = can("settings.update");
  const { busy, msg, setMsg, save } = useSave(clubId, onSaved);
  const [form, setForm] = useState<PolicyForm>(() => toForm(data.cancellation_policy));
  const policy = toPolicy(form);
  const setTier = (i: number, k: keyof Tier, v: string) => setForm((f) => ({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const pctInput = "w-20 text-center";

  return (
    <Card className="space-y-4">
      <div className="font-display text-lg font-bold">{t("pay.policy.title")}</div>
      <p className="text-sm text-muted">{t("pay.policy.hint")}</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted">{t("pay.policy.presets")}</span>
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => (
            <Chip key={k} onClick={() => setForm(PRESETS[k])}>
              {t(`pay.policy.preset.${k}` as never)}
            </Chip>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {form.tiers.map((x, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <span>{t("pay.policy.ifMore")}</span>
            <Input className="w-20 text-center" type="number" min={0.25} step={0.25} value={x.hours} onChange={(e) => setTier(i, "hours", e.target.value)} disabled={!editable} />
            <span>{t("pay.policy.hoursLeft")}</span>
            <Input className={pctInput} type="number" min={0} max={100} value={x.percent} onChange={(e) => setTier(i, "percent", e.target.value)} disabled={!editable} />
            <span>%</span>
            {editable && (
              <button type="button" className="ml-auto text-muted hover:text-danger-soft" onClick={() => setForm((f) => ({ ...f, tiers: f.tiers.filter((_, j) => j !== i) }))} aria-label={t("common.delete")}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {editable && form.tiers.length < 6 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, tiers: [...f.tiers, { hours: "1", percent: "50" }] }))}>
            <Plus className="h-4 w-4" /> {t("pay.policy.addTier")}
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
          <span>{t("pay.policy.later")}</span>
          <Input className={pctInput} type="number" min={0} max={100} value={form.rest} onChange={(e) => setForm((f) => ({ ...f, rest: e.target.value }))} disabled={!editable} />
          <span>%</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
          <span>{t("pay.policy.noShowLabel")}</span>
          <Input className={pctInput} type="number" min={0} max={100} value={form.noShow} onChange={(e) => setForm((f) => ({ ...f, noShow: e.target.value }))} disabled={!editable} />
          <span>%</span>
        </div>
      </div>

      {/* Mijoz to'lov paytida ko'radigan matn */}
      <div className="space-y-2 rounded-xl border border-line p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-muted">{t("pay.policy.preview")}</div>
        {policy ? (
          <ul className="space-y-1.5 text-sm">
            {policyLines(policy, t).map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{l.when}</span>
                <span className={cx("shrink-0 font-bold", l.percent === 100 ? "text-accent" : l.percent === 0 ? "text-danger-soft" : "text-warn")}>{l.what}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-danger-soft">{t("pay.policy.invalid")}</div>
        )}
        <p className="text-xs text-muted">{t("pay.policy.snapshotNote")}</p>
      </div>

      {editable && (
        <Button
          loading={busy === "policy"}
          disabled={!policy}
          onClick={() => {
            if (!policy) return setMsg({ tone: "error", text: t("pay.policy.invalid") });
            save("policy", { cancellation_policy: policy });
          }}
        >
          {t("common.save")}
        </Button>
      )}
    </Card>
  );
}
