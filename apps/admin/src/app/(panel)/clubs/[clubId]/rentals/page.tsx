"use client";

import { formatDateTime, formatMoney, parseSom, tiyinToSomInput } from "@gc/types";
import { AlertTriangle, Gamepad2, MapPin, Package, Phone, Store, Truck } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BranchPicker, ClubHeader } from "@/components/club-tabs";
import { isShiftRequired } from "@/components/live/device-panel";
import { Empty, LoadState } from "@/components/status";
import { Alert, Badge, Button, Card, Chip, Field, Input, Select, cx } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { useLiveBranch } from "@/lib/live-socket";
import { useMyClub } from "@/lib/my-club";
import { session, useAuth } from "@/lib/session";
import { RENTAL_TYPES, type Rental, type RentalItem, type RentalStatus } from "@/lib/types";
import { idemKey, useApi } from "@/lib/use-api";

const RENTAL_TONE: Record<RentalStatus, "neutral" | "green" | "red" | "amber" | "violet"> = {
  REQUESTED: "amber",
  CONFIRMED: "green",
  ACTIVE: "violet",
  RETURNED: "neutral",
  CANCELLED: "neutral",
  REJECTED: "red",
  EXPIRED: "neutral",
};

/** Konsol arendasi: mijoz so'rovlari (tasdiqlash → topshirish → qaytarish) va arendaga beriladigan konsollar. */
export default function RentalsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t } = useI18n();
  const { can } = useAuth();
  const { branches, loading } = useMyClub(clubId);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<"orders" | "items">("orders");
  const branchId = picked ?? branches[0]?.id ?? null;

  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      {!loading && branches.length === 0 && <Empty>{t("branch.empty")}</Empty>}
      {branches.length > 1 && <BranchPicker branches={branches} value={branchId} onChange={setPicked} />}
      <div className="flex gap-2">
        <Chip active={view === "orders"} onClick={() => setView("orders")}>
          {t("rental.view.orders")}
        </Chip>
        <Chip active={view === "items"} onClick={() => setView("items")}>
          {t("rental.view.items")}
        </Chip>
      </div>
      {branchId && view === "orders" && <Orders key={branchId} branchId={branchId} />}
      {branchId && view === "items" && <Items key={branchId} branchId={branchId} canManage={can("rentals.manage")} />}
    </div>
  );
}

// ---------- So'rovlar ----------

type Filter = "OPEN" | "OVERDUE" | "HISTORY";

function Orders({ branchId }: { branchId: string }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("OPEN");
  const list = useApi<Rental[]>(`/rentals?staff=true&branch_id=${branchId}&status=${filter}&limit=100`);
  useLiveBranch(branchId, list.reload);

  const rows = list.data ?? [];
  const requested = rows.filter((r) => r.status === "REQUESTED").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["OPEN", "OVERDUE", "HISTORY"] as const).map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {t(`rental.filter.${f}` as MessageKey)}
          </Chip>
        ))}
        {filter === "OPEN" && requested > 0 && <Badge tone="amber">{t("rental.newRequests", { n: requested })}</Badge>}
      </div>
      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
      {list.data && rows.length === 0 && <Empty>{t(`rental.empty.${filter}` as MessageKey)}</Empty>}
      <div className="grid gap-3 xl:grid-cols-2">
        {rows.map((r) => (
          <OrderCard key={r.id} r={r} onChanged={list.reload} />
        ))}
      </div>
    </div>
  );
}

const PAY_METHODS = ["CASH", "TERMINAL", "CARD_TRANSFER", "LATER"] as const;

function OrderCard({ r, onChanged }: { r: Rental; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const [panel, setPanel] = useState<"reject" | "handover" | "return" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const [deposit, setDeposit] = useState(true);
  const [lateFee, setLateFee] = useState(r.suggested_late_fee ? tiyinToSomInput(r.suggested_late_fee) : "");
  const [depositBack, setDepositBack] = useState<"RETURNED" | "KEPT">("RETURNED");

  const tz = r.branch?.timezone;
  const money = (n: number) => formatMoney(n, locale);
  const process = can("rentals.process");
  const due = r.total_amount - r.paid_amount;
  const late = lateFee ? parseSom(lateFee) ?? 0 : 0;
  const returnDue = due + late;
  const customer = [r.customer?.first_name, r.customer?.last_name].filter(Boolean).join(" ");
  const phone = r.contact_phone ?? r.customer?.phone ?? null;

  async function act(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setMsg(null);
    try {
      await session.post(`/rentals/${r.id}/${path}`, body, { "Idempotency-Key": idemKey() });
      setPanel(null);
      onChanged();
    } catch (e) {
      setMsg(isShiftRequired(e) ? t("errors.SHIFT_REQUIRED") : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cx("space-y-3", r.is_overdue && "ring-1 ring-danger/50")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
            <Gamepad2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="font-display text-lg font-bold leading-tight">
              {r.item_snapshot.name}
              {r.quantity > 1 && <span className="text-muted"> × {r.quantity}</span>}
            </div>
            <div className="font-mono text-xs text-muted">{r.code}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.is_overdue && (
            <Badge tone="red">
              <AlertTriangle className="mr-1 h-3 w-3" />
              {t("rental.overdueBy", { h: Math.floor(r.overdue_minutes / 60), m: r.overdue_minutes % 60 })}
            </Badge>
          )}
          <Badge tone={RENTAL_TONE[r.status]}>{t(`rentalStatus.${r.status}` as MessageKey)}</Badge>
        </div>
      </div>

      <div className="grid gap-2 rounded-xl bg-surface-2 p-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs text-muted">{t("rental.pickup")}</div>
          <div className="font-semibold tabular-nums">{formatDateTime(r.start_at, tz, locale)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">{t("rental.returnBy")}</div>
          <div className={cx("font-semibold tabular-nums", r.is_overdue && "text-danger-soft")}>{formatDateTime(r.end_at, tz, locale)}</div>
        </div>
        <div className="text-muted">{t(r.rate_unit === "HOUR" ? "rental.hoursN" : "rental.daysN", { n: r.units })}</div>
        <div className="flex items-center gap-1.5 text-muted">
          {r.fulfillment === "DELIVERY" ? <Truck className="h-4 w-4" /> : <Store className="h-4 w-4" />}
          {t(`rental.fulfillment.${r.fulfillment}` as MessageKey)}
        </div>
        {r.delivery_address && (
          <div className="flex items-start gap-1.5 sm:col-span-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            {r.delivery_address}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="min-w-0">
          <div className="font-semibold">{customer || t("rental.customer")}</div>
          {phone && (
            <a href={`tel:${phone}`} className="inline-flex items-center gap-1 text-accent hover:underline">
              <Phone className="h-3.5 w-3.5" />
              {phone}
            </a>
          )}
        </div>
        <div className="text-right">
          <div className="font-display text-lg font-bold tabular-nums">{money(r.total_amount)}</div>
          <div className="text-xs text-muted">
            {r.payment_status === "PAID" ? t("rental.paid") : due > 0 ? t("rental.due", { amount: money(due) }) : ""}
            {r.deposit_amount > 0 && ` · ${t("rental.deposit")}: ${money(r.deposit_amount)}${r.deposit_status !== "NONE" ? ` (${t(`rental.depositStatus.${r.deposit_status}` as MessageKey)})` : ""}`}
          </div>
        </div>
      </div>
      {r.notes && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">{r.notes}</p>}
      {r.cancel_reason && <p className="text-sm text-danger-soft">{r.cancel_reason}</p>}
      {msg && <Alert>{msg}</Alert>}

      {process && panel === "reject" && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act("reject", { reason: reason.trim() });
          }}
        >
          <Input className="h-10 min-w-0 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("rental.rejectReason")} minLength={2} maxLength={300} required />
          <Button size="sm" variant="danger" loading={busy}>
            {t("rental.reject")}
          </Button>
        </form>
      )}

      {process && panel === "handover" && (
        <div className="space-y-3 rounded-xl border border-line p-3">
          {due > 0 && (
            <Field label={t("rental.collect", { amount: money(due) })}>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAY_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`rental.method.${m}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {r.deposit_amount > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={deposit} onChange={(e) => setDeposit(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
              {t("rental.depositCollected", { amount: money(r.deposit_amount) })}
            </label>
          )}
          <Button size="sm" loading={busy} onClick={() => act("handover", { payment_method: due > 0 ? method : "LATER", deposit_collected: deposit })}>
            {t("rental.handoverConfirm")}
          </Button>
        </div>
      )}

      {process && panel === "return" && (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <Field label={t("rental.lateFee")} hint={r.suggested_late_fee ? t("rental.lateFeeHint", { amount: money(r.suggested_late_fee) }) : undefined}>
            <Input inputMode="numeric" value={lateFee} onChange={(e) => setLateFee(e.target.value)} placeholder="0" />
          </Field>
          {returnDue > 0 && (
            <Field label={t("rental.collect", { amount: money(returnDue) })}>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAY_METHODS.filter((m) => m !== "LATER").map((m) => (
                  <option key={m} value={m}>
                    {t(`rental.method.${m}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {r.deposit_status === "HELD" && (
            <Field label={t("rental.deposit")}>
              <Select value={depositBack} onChange={(e) => setDepositBack(e.target.value as "RETURNED" | "KEPT")}>
                <option value="RETURNED">{t("rental.depositStatus.RETURNED")}</option>
                <option value="KEPT">{t("rental.depositStatus.KEPT")}</option>
              </Select>
            </Field>
          )}
          <Button
            size="sm"
            loading={busy}
            onClick={() =>
              act("return", {
                late_fee: late,
                ...(returnDue > 0 ? { payment_method: method === "LATER" ? "CASH" : method } : {}),
                ...(r.deposit_status === "HELD" ? { deposit: depositBack } : {}),
              })
            }
          >
            {t("rental.returnConfirm")}
          </Button>
        </div>
      )}

      {process && (
        <div className="flex flex-wrap gap-2">
          {r.status === "REQUESTED" && (
            <Button size="sm" loading={busy && !panel} onClick={() => act("confirm")}>
              {t("rental.confirm")}
            </Button>
          )}
          {(r.status === "REQUESTED" || r.status === "CONFIRMED") && (
            <>
              <Button size="sm" variant={r.status === "CONFIRMED" ? "primary" : "secondary"} onClick={() => setPanel(panel === "handover" ? null : "handover")}>
                <Package className="h-4 w-4" />
                {t("rental.handover")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPanel(panel === "reject" ? null : "reject")}>
                {t("rental.reject")}
              </Button>
            </>
          )}
          {r.status === "ACTIVE" && (
            <Button size="sm" onClick={() => setPanel(panel === "return" ? null : "return")}>
              {t("rental.return")}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------- Inventar ----------

function Items({ branchId, canManage }: { branchId: string; canManage: boolean }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const items = useApi<RentalItem[]>(`/branches/${branchId}/rental-items/manage`);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const money = (n: number) => formatMoney(n, locale);

  async function save(id: string | null, body: Record<string, unknown>) {
    setMsg(null);
    try {
      if (id) await session.patch(`/rental-items/${id}`, body);
      else await session.post(`/branches/${branchId}/rental-items`, body);
      setEditing(null);
      setMsg({ tone: "success", text: t("common.saved") });
      items.reload();
      return true;
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
      return false;
    }
  }

  async function remove(it: RentalItem) {
    if (!confirm(t("rental.item.confirmDelete", { name: it.name }))) return;
    try {
      await session.delete(`/rental-items/${it.id}`);
      items.reload();
    } catch (e) {
      const reason = (e as { details?: { reason?: string } }).details?.reason;
      setMsg({ tone: "error", text: reason === "OPEN_RENTALS" ? t("rental.item.hasOpen") : errorText(e) });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted">{t("rental.item.hint")}</p>
        {canManage && editing !== "new" && <Button onClick={() => setEditing("new")}>{t("rental.item.new")}</Button>}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {editing === "new" && (
        <Card>
          <ItemForm onCancel={() => setEditing(null)} onSubmit={(b) => save(null, b)} />
        </Card>
      )}
      <LoadState loading={items.loading} error={items.error} onRetry={items.reload} />
      {!items.loading && items.data?.length === 0 && editing !== "new" && <Empty>{t("rental.item.empty")}</Empty>}
      <div className="grid gap-3 xl:grid-cols-2">
        {items.data?.map((it) =>
          editing === it.id ? (
            <Card key={it.id} className="xl:col-span-2">
              <ItemForm item={it} onCancel={() => setEditing(null)} onSubmit={(b) => save(it.id, b)} />
            </Card>
          ) : (
            <Card key={it.id} className={cx("space-y-3", it.status !== "ACTIVE" && "opacity-60")}>
              <div className="flex items-start gap-3">
                {it.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                    <Gamepad2 className="h-7 w-7" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-bold">{it.name}</span>
                    {it.status !== "ACTIVE" && <Badge>{t("rental.item.hidden")}</Badge>}
                  </div>
                  <div className="text-sm text-muted">{t(`rentalType.${it.type}` as MessageKey)}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone={it.available_now > 0 ? "green" : "red"}>{t("rental.item.availableOf", { n: it.available_now, total: it.quantity })}</Badge>
                    {it.requested_count > 0 && <Badge tone="amber">{t("rental.newRequests", { n: it.requested_count })}</Badge>}
                    {it.delivery_available && <Badge tone="violet">{t("rental.fulfillment.DELIVERY")}</Badge>}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <PriceTile label={t("rental.perHour")} value={it.price_per_hour != null ? money(it.price_per_hour) : "—"} />
                <PriceTile label={t("rental.perDay")} value={it.price_per_day != null ? money(it.price_per_day) : "—"} />
                {it.deposit_amount > 0 && <PriceTile label={t("rental.deposit")} value={money(it.deposit_amount)} />}
                {it.delivery_available && <PriceTile label={t("rental.deliveryFee")} value={money(it.delivery_fee)} />}
              </div>
              {it.includes.length > 0 && <div className="text-sm text-muted">{it.includes.join(" · ")}</div>}
              {canManage && (
                <div className="flex gap-3">
                  <button className="text-xs font-semibold text-muted hover:text-fg" onClick={() => setEditing(it.id)}>
                    {t("common.edit")}
                  </button>
                  <button className="text-xs font-semibold text-muted hover:text-fg" onClick={() => save(it.id, { status: it.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}>
                    {it.status === "ACTIVE" ? t("rental.item.hide") : t("rental.item.show")}
                  </button>
                  <button className="text-xs font-semibold text-danger-soft hover:underline" onClick={() => remove(it)}>
                    {t("common.delete")}
                  </button>
                </div>
              )}
            </Card>
          ),
        )}
      </div>
    </div>
  );
}

function PriceTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

const lines = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

function ItemForm({ item, onSubmit, onCancel }: { item?: RentalItem; onSubmit: (b: Record<string, unknown>) => Promise<boolean>; onCancel: () => void }) {
  const { t } = useI18n();
  const som = (n: number | null | undefined) => (n == null ? "" : tiyinToSomInput(n));
  const [f, setF] = useState({
    name: item?.name ?? "",
    type: item?.type ?? "PS5",
    quantity: String(item?.quantity ?? 1),
    hour: som(item?.price_per_hour),
    day: som(item?.price_per_day),
    min_hours: String(item?.min_hours ?? 1),
    max_days: String(item?.max_days ?? 30),
    deposit: item?.deposit_amount ? som(item.deposit_amount) : "",
    delivery: item?.delivery_available ?? false,
    delivery_fee: item?.delivery_fee ? som(item.delivery_fee) : "",
    image_url: item?.image_url ?? "",
    includes: item?.includes.join("\n") ?? "",
    games: item?.games.join(", ") ?? "",
    requirements: item?.requirements ?? "",
    description: item?.description ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const hour = f.hour.trim() ? parseSom(f.hour) : null;
    const day = f.day.trim() ? parseSom(f.day) : null;
    const deposit = f.deposit.trim() ? parseSom(f.deposit) : 0;
    const fee = f.delivery_fee.trim() ? parseSom(f.delivery_fee) : 0;
    if ((f.hour.trim() && hour === null) || (f.day.trim() && day === null) || deposit === null || fee === null) {
      setError(t("tariff.badPrice"));
      return;
    }
    if (hour === null && day === null) {
      setError(t("rental.item.needPrice"));
      return;
    }
    setError(null);
    setBusy(true);
    const ok = await onSubmit({
      name: f.name.trim(),
      type: f.type,
      quantity: Number(f.quantity) || 1,
      price_per_hour: hour,
      price_per_day: day,
      min_hours: Number(f.min_hours) || 1,
      max_days: Number(f.max_days) || 30,
      deposit_amount: deposit,
      delivery_available: f.delivery,
      delivery_fee: f.delivery ? fee : 0,
      ...(f.image_url.trim() ? { image_url: f.image_url.trim() } : {}),
      includes: lines(f.includes),
      games: lines(f.games),
      ...(f.requirements.trim() || item ? { requirements: f.requirements.trim() } : {}),
      ...(f.description.trim() || item ? { description: f.description.trim() } : {}),
    });
    if (!ok) setBusy(false);
  }

  const area = "min-h-[84px] w-full rounded-[14px] border border-line bg-surface px-4 py-3 text-[15px] text-fg outline-none placeholder:text-muted focus:border-accent";

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("rental.item.name")}>
          <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("rental.item.namePlaceholder")} minLength={2} maxLength={80} required />
        </Field>
        <Field label={t("rental.item.type")}>
          <Select value={f.type} onChange={(e) => set({ type: e.target.value })}>
            {RENTAL_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`rentalType.${x}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("rental.item.quantity")} hint={t("rental.item.quantityHint")}>
          <Input type="number" min={1} max={100} value={f.quantity} onChange={(e) => set({ quantity: e.target.value })} required />
        </Field>
        <Field label={t("rental.item.priceHour")} hint={t("rental.item.priceEmptyHint")}>
          <Input inputMode="numeric" value={f.hour} onChange={(e) => set({ hour: e.target.value })} placeholder="20000" />
        </Field>
        <Field label={t("rental.item.priceDay")} hint={t("rental.item.priceEmptyHint")}>
          <Input inputMode="numeric" value={f.day} onChange={(e) => set({ day: e.target.value })} placeholder="150000" />
        </Field>
        <Field label={t("rental.item.depositLabel")} hint={t("rental.item.depositHint")}>
          <Input inputMode="numeric" value={f.deposit} onChange={(e) => set({ deposit: e.target.value })} placeholder="0" />
        </Field>
        <Field label={t("rental.item.minHours")}>
          <Input type="number" min={1} max={72} value={f.min_hours} onChange={(e) => set({ min_hours: e.target.value })} />
        </Field>
        <Field label={t("rental.item.maxDays")}>
          <Input type="number" min={1} max={90} value={f.max_days} onChange={(e) => set({ max_days: e.target.value })} />
        </Field>
        <Field label={t("rental.item.image")}>
          <Input type="url" value={f.image_url} onChange={(e) => set({ image_url: e.target.value })} placeholder="https://…" />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-4 rounded-xl bg-surface-2 p-3">
        <label className="flex h-12 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={f.delivery} onChange={(e) => set({ delivery: e.target.checked })} className="h-4 w-4 accent-[var(--color-accent)]" />
          {t("rental.item.deliveryAvailable")}
        </label>
        {f.delivery && (
          <div className="w-48">
            <Field label={t("rental.deliveryFee")}>
              <Input inputMode="numeric" value={f.delivery_fee} onChange={(e) => set({ delivery_fee: e.target.value })} placeholder="20000" />
            </Field>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("rental.item.includes")} hint={t("rental.item.includesHint")}>
          <textarea className={area} value={f.includes} onChange={(e) => set({ includes: e.target.value })} placeholder={t("rental.item.includesPlaceholder")} />
        </Field>
        <Field label={t("rental.item.games")} hint={t("rental.item.gamesHint")}>
          <textarea className={area} value={f.games} onChange={(e) => set({ games: e.target.value })} placeholder="EA FC 25, Mortal Kombat 1" />
        </Field>
        <Field label={t("rental.item.requirements")}>
          <textarea className={area} value={f.requirements} onChange={(e) => set({ requirements: e.target.value })} placeholder={t("rental.item.requirementsPlaceholder")} maxLength={500} />
        </Field>
        <Field label={t("rental.item.description")}>
          <textarea className={area} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button loading={busy}>{t("common.save")}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
