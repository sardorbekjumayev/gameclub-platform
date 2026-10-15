"use client";

import { formatDateTime, formatMoney, parseSom, tiyinToSomInput } from "@gc/types";
import { useState } from "react";
import { Pager } from "@/components/analytics";
import { Empty, LoadState } from "@/components/status";
import { Alert, Badge, Button, Card, Field, Input, Select, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { Promotion } from "@/lib/types";
import { idemKey, useApi } from "@/lib/use-api";

const LIMIT = 20;
const TASHKENT_OFFSET = "+05:00";
/** ISO (UTC) → `datetime-local` qiymati Toshkent vaqtida. */
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => new Date(`${v}:00${TASHKENT_OFFSET}`).toISOString();

/**
 * Promo kodlar ro'yxati va formasi (docs/01-API.md §6.12).
 * `listPath` — ro'yxat; `createPath` — yangi kod qayerga qo'shiladi (null — qo'shish yopiq, masalan "barcha klublar" ko'rinishida).
 */
export function PromotionsManager({
  listPath,
  createPath,
  canManage,
  showClub,
  createHint,
}: {
  listPath: string;
  createPath: string | null;
  canManage: boolean;
  showClub?: boolean;
  createHint?: string;
}) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const sep = listPath.includes("?") ? "&" : "?";
  const list = useApi<Promotion[]>(`${listPath}${sep}page=${page}&limit=${LIMIT}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function run(fn: () => Promise<unknown>, success = t("common.saved")) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: success });
      setEditing(null);
      list.reload();
      return true;
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
      return false;
    }
  }

  const discount = (p: Promotion) => (p.type === "PERCENT" ? `${p.value}%` : formatMoney(p.value, locale));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="max-w-xs"
          placeholder={t("promo.searchPlaceholder")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value.toUpperCase());
            setPage(1);
          }}
        />
        {canManage && editing !== "new" && (
          <Button onClick={() => setEditing("new")} disabled={!createPath}>
            {t("promo.new")}
          </Button>
        )}
      </div>
      {canManage && !createPath && createHint && <Alert tone="info">{createHint}</Alert>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {editing === "new" && createPath && (
        <Card>
          <PromoForm onCancel={() => setEditing(null)} onSubmit={(body) => run(() => session.post(createPath, body, { "Idempotency-Key": idemKey() }), t("promo.created"))} />
        </Card>
      )}
      <LoadState loading={list.loading} error={list.error} onRetry={list.reload} />
      {list.data?.length === 0 && <Empty>{t("promo.empty")}</Empty>}
      <div className="space-y-3">
        {list.data?.map((p) =>
          editing === p.id ? (
            <Card key={p.id}>
              <PromoForm promo={p} onCancel={() => setEditing(null)} onSubmit={(body) => run(() => session.patch(`/promotions/${p.id}`, body))} />
            </Card>
          ) : (
            <Card key={p.id} className={cx("flex flex-wrap items-start justify-between gap-4", !p.is_active && "opacity-60")}>
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-bold">{p.code}</span>
                  <Badge tone="green">−{discount(p)}</Badge>
                  {!p.is_active && <Badge>{t("promo.inactive")}</Badge>}
                  <Badge tone={p.funded_by === "PLATFORM" ? "violet" : "neutral"}>{t(p.funded_by === "PLATFORM" ? "promo.fundedPlatform" : "promo.fundedClub")}</Badge>
                  {showClub && <Badge tone="amber">{p.club?.name ?? t("promo.platformWide")}</Badge>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                  <span>{t("promo.used", { used: p.used_count, limit: p.usage_limit ?? "∞" })}</span>
                  {p.per_user_limit != null && <span>{t("promo.perUserShort", { n: p.per_user_limit })}</span>}
                  {p.min_order_amount != null && <span>{t("promo.minOrderShort", { amount: formatMoney(p.min_order_amount, locale) })}</span>}
                  {p.type === "PERCENT" && p.max_discount_amount != null && <span>{t("promo.maxDiscountShort", { amount: formatMoney(p.max_discount_amount, locale) })}</span>}
                  {(p.starts_at || p.ends_at) && (
                    <span>
                      {p.starts_at ? formatDateTime(p.starts_at) : "…"} — {p.ends_at ? formatDateTime(p.ends_at) : "…"}
                    </span>
                  )}
                </div>
              </div>
              {canManage && (
                <span className="flex gap-3">
                  <button className="text-xs font-semibold text-muted hover:text-fg" onClick={() => setEditing(p.id)}>
                    {t("common.edit")}
                  </button>
                  <button className="text-xs font-semibold text-muted hover:text-fg" onClick={() => run(() => session.patch(`/promotions/${p.id}`, { is_active: !p.is_active }))}>
                    {p.is_active ? t("tariff.deactivate") : t("tariff.activate")}
                  </button>
                  <button
                    className="text-xs font-semibold text-danger-soft hover:underline"
                    onClick={() => confirm(t("promo.confirmDelete", { code: p.code })) && run(() => session.delete(`/promotions/${p.id}`), t("promo.deleted"))}
                  >
                    {t("common.delete")}
                  </button>
                </span>
              )}
            </Card>
          ),
        )}
      </div>
      <Pager page={page} total={list.meta?.total ?? 0} limit={LIMIT} onPage={setPage} />
    </div>
  );
}

function PromoForm({ promo, onSubmit, onCancel }: { promo?: Promotion; onSubmit: (b: Record<string, unknown>) => Promise<boolean>; onCancel: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(promo?.code ?? "");
  const [type, setType] = useState<"PERCENT" | "FIXED">(promo?.type ?? "PERCENT");
  const [value, setValue] = useState(promo ? (promo.type === "PERCENT" ? String(promo.value) : tiyinToSomInput(promo.value)) : "");
  const [maxDiscount, setMaxDiscount] = useState(promo?.max_discount_amount != null ? tiyinToSomInput(promo.max_discount_amount) : "");
  const [minOrder, setMinOrder] = useState(promo?.min_order_amount != null ? tiyinToSomInput(promo.min_order_amount) : "");
  const [usageLimit, setUsageLimit] = useState(promo?.usage_limit != null ? String(promo.usage_limit) : "");
  const [perUser, setPerUser] = useState(promo?.per_user_limit != null ? String(promo.per_user_limit) : "");
  const [startsAt, setStartsAt] = useState(toLocal(promo?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocal(promo?.ends_at ?? null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Bo'sh — berilmagan; noto'g'ri — xato. */
  const som = (v: string) => (v.trim() ? parseSom(v) : undefined);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const val = type === "PERCENT" ? Number(value) : parseSom(value);
        const max = som(maxDiscount);
        const min = som(minOrder);
        if (val === null || !Number.isInteger(val) || val < 1 || (type === "PERCENT" && val > 100)) {
          setError(t(type === "PERCENT" ? "promo.badPercent" : "tariff.badPrice"));
          return;
        }
        if (max === null || min === null) {
          setError(t("tariff.badPrice"));
          return;
        }
        if (startsAt && endsAt && startsAt >= endsAt) {
          setError(t("promo.badPeriod"));
          return;
        }
        setError(null);
        setBusy(true);
        await onSubmit({
          ...(!promo && { code, type }),
          value: val,
          ...(type === "PERCENT" && max !== undefined && { max_discount_amount: max }),
          ...(min !== undefined && { min_order_amount: min }),
          ...(usageLimit && { usage_limit: Number(usageLimit) }),
          ...(perUser && { per_user_limit: Number(perUser) }),
          ...(startsAt && { starts_at: fromLocal(startsAt) }),
          ...(endsAt && { ends_at: fromLocal(endsAt) }),
        });
        setBusy(false);
      }}
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("promo.code")} hint={t("promo.codeHint")}>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
            disabled={!!promo}
            pattern="[A-Z0-9_\-]{3,32}"
            required
            placeholder="ZONUP10"
          />
        </Field>
        <Field label={t("promo.type")}>
          <Select value={type} onChange={(e) => setType(e.target.value as "PERCENT" | "FIXED")} disabled={!!promo}>
            <option value="PERCENT">{t("promo.typePercent")}</option>
            <option value="FIXED">{t("promo.typeFixed")}</option>
          </Select>
        </Field>
        <Field label={type === "PERCENT" ? t("promo.valuePercent") : t("promo.valueFixed")} hint={type === "FIXED" ? t("tariff.somHint") : undefined}>
          <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} required placeholder={type === "PERCENT" ? "10" : "20000"} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {type === "PERCENT" && (
          <Field label={t("promo.maxDiscount")} hint={t("tariff.somHint")}>
            <Input inputMode="numeric" value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)} />
          </Field>
        )}
        <Field label={t("promo.minOrder")} hint={t("tariff.somHint")}>
          <Input inputMode="numeric" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
        </Field>
        <Field label={t("promo.usageLimit")} hint={t("promo.emptyUnlimited")}>
          <Input type="number" min={1} value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} />
        </Field>
        <Field label={t("promo.perUser")} hint={t("promo.emptyUnlimited")}>
          <Input type="number" min={1} value={perUser} onChange={(e) => setPerUser(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("promo.startsAt")} hint="Asia/Tashkent">
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label={t("promo.endsAt")} hint="Asia/Tashkent">
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
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
