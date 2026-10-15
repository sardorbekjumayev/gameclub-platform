"use client";

import { formatMoney, parseSom, tiyinToSomInput } from "@gc/types";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BranchPicker, ClubHeader } from "@/components/club-tabs";
import { Empty, LoadState } from "@/components/status";
import { Alert, Badge, Button, Card, Field, Input, Select, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { useMyClub } from "@/lib/my-club";
import { session, useAuth } from "@/lib/session";
import { DEVICE_TYPES, type Device, type DeviceCategory, type Quote, RULE_KINDS, type Room, type Tariff, type TariffPackage, type TariffRule } from "@/lib/types";
import { useApi } from "@/lib/use-api";

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
/** Filial vaqt zonasi Asia/Tashkent — doimiy UTC+05:00 (DST yo'q). Forma vaqti shu zonada kiritiladi. */
const TASHKENT_OFFSET = "+05:00";

export default function TariffsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t } = useI18n();
  const { branches, loading } = useMyClub(clubId);
  const [picked, setPicked] = useState<string | null>(null);
  const branchId = picked ?? branches[0]?.id ?? null;

  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      {!loading && branches.length === 0 && <Empty>{t("branch.empty")}</Empty>}
      {branches.length > 1 && <BranchPicker branches={branches} value={branchId} onChange={setPicked} />}
      {branchId && <BranchTariffs key={branchId} branchId={branchId} />}
    </div>
  );
}

function BranchTariffs({ branchId }: { branchId: string }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const tariffs = useApi<Tariff[]>(`/branches/${branchId}/tariffs/manage`);
  const categories = useApi<DeviceCategory[]>(`/branches/${branchId}/device-categories`);
  const rooms = useApi<Room[]>(can("rooms.view") ? `/branches/${branchId}/rooms` : null);
  const devices = useApi<Device[]>(`/branches/${branchId}/devices`);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const refs = { categories: categories.data ?? [], rooms: rooms.data ?? [], devices: devices.data ?? [] };
  const targetLabel = (tr: Tariff) => {
    if (tr.device_id) return `${t("tariff.target.device")}: ${refs.devices.find((d) => d.id === tr.device_id)?.name ?? "—"}`;
    if (tr.room_id) return `${t("tariff.target.room")}: ${refs.rooms.find((r) => r.id === tr.room_id)?.name ?? "—"}`;
    if (tr.category_id) return `${t("tariff.target.category")}: ${refs.categories.find((c) => c.id === tr.category_id)?.name ?? "—"}`;
    if (tr.device_type) return `${t("tariff.target.type")}: ${t(`deviceType.${tr.device_type}` as never)}`;
    return t("tariff.target.all");
  };

  async function save(id: string | null, body: Record<string, unknown>) {
    setMsg(null);
    try {
      if (id) await session.patch(`/tariffs/${id}`, body);
      else await session.post(`/branches/${branchId}/tariffs`, body);
      setEditing(null);
      setMsg({ tone: "success", text: t("common.saved") });
      tariffs.reload();
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    }
  }

  async function remove(tr: Tariff) {
    if (!confirm(t("tariff.confirmDelete", { name: tr.name }))) return;
    try {
      await session.delete(`/tariffs/${tr.id}`);
      tariffs.reload();
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted">{t("tariff.hint")}</p>
          {can("tariffs.create") && editing !== "new" && <Button onClick={() => setEditing("new")}>{t("tariff.new")}</Button>}
        </div>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {editing === "new" && (
          <Card>
            <TariffForm refs={refs} onCancel={() => setEditing(null)} onSubmit={(b) => save(null, b)} />
          </Card>
        )}
        <LoadState loading={tariffs.loading} error={tariffs.error} onRetry={tariffs.reload} />
        {!tariffs.loading && tariffs.data?.length === 0 && editing !== "new" && <Empty>{t("tariff.empty")}</Empty>}
        {tariffs.data?.map((tr) =>
          editing === tr.id ? (
            <Card key={tr.id}>
              <TariffForm tariff={tr} refs={refs} onCancel={() => setEditing(null)} onSubmit={(b) => save(tr.id, b)} />
            </Card>
          ) : (
            <Card key={tr.id} className={cx("space-y-3", !tr.is_active && "opacity-60")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg font-bold">{tr.name}</span>
                    {!tr.is_active && <Badge>{t("tariff.inactive")}</Badge>}
                    {tr.priority > 0 && <Badge tone="violet">{t("tariff.priorityN", { n: tr.priority })}</Badge>}
                  </div>
                  <div className="text-sm text-muted">{targetLabel(tr)}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-xl font-bold text-accent tabular-nums">{formatMoney(tr.price_per_hour, locale)}</div>
                  <div className="text-xs text-muted">{t("tariff.perHour")}</div>
                </div>
              </div>
              {tr.rules.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {tr.rules.map((r, i) => (
                    <li key={r.id ?? i} className="flex flex-wrap justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                      <span>
                        <Badge tone="amber">{t(`tariff.kind.${r.kind}` as never)}</Badge> <span className="ml-1">{daysLabel(r.days_of_week, t)}</span>{" "}
                        <span className="font-mono text-xs text-muted">
                          {r.date ? `${r.date.slice(0, 10)} ` : ""}
                          {r.start_time}–{r.end_time}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">{formatMoney(r.price_per_hour, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!!tr.packages?.length && (
                <div className="space-y-1">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">{t("pkg.title")}</div>
                  <ul className="space-y-1 text-sm">
                    {tr.packages.map((p) => (
                      <li key={p.id} className={cx("flex flex-wrap justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2", !p.is_active && "opacity-60")}>
                        <span>
                          <Badge tone="violet">{durationLabel(p.duration_minutes, t)}</Badge> <span className="ml-1 font-semibold">{p.name}</span>{" "}
                          <span className="text-xs text-muted">{packageWhen(p, t)}</span>
                          {!p.is_active && <span className="ml-1 text-xs text-muted">· {t("tariff.inactive")}</span>}
                        </span>
                        <span className="text-right">
                          <span className="font-semibold tabular-nums">{formatMoney(p.price, locale)}</span>
                          <Savings regular={regularAmount(tr.price_per_hour, p.duration_minutes)} price={p.price} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(tr.min_minutes || tr.max_minutes) && (
                <div className="text-xs text-muted">
                  {tr.min_minutes ? t("tariff.minN", { n: tr.min_minutes }) : ""} {tr.max_minutes ? t("tariff.maxN", { n: tr.max_minutes }) : ""}
                </div>
              )}
              <div className="flex gap-3">
                {can("tariffs.update") && (
                  <button className="text-xs font-semibold text-muted hover:text-fg" onClick={() => setEditing(tr.id)}>
                    {t("common.edit")}
                  </button>
                )}
                {can("tariffs.update") && (
                  <button className="text-xs font-semibold text-muted hover:text-fg" onClick={() => save(tr.id, { is_active: !tr.is_active })}>
                    {tr.is_active ? t("tariff.deactivate") : t("tariff.activate")}
                  </button>
                )}
                {can("tariffs.delete") && (
                  <button className="text-xs font-semibold text-danger-soft hover:underline" onClick={() => remove(tr)}>
                    {t("common.delete")}
                  </button>
                )}
              </div>
            </Card>
          ),
        )}
      </div>
      <PriceCalculator branchId={branchId} devices={refs.devices} packages={(tariffs.data ?? []).filter((tr) => tr.is_active).flatMap((tr) => (tr.packages ?? []).filter((p) => p.is_active))} />
    </div>
  );
}

function daysLabel(days: number[], t: (k: never) => string) {
  const s = [...days].sort().join(",");
  if (s === "1,2,3,4,5,6,7") return t("tariff.days.all" as never);
  if (s === "1,2,3,4,5") return t("tariff.days.weekdays" as never);
  if (s === "6,7") return t("tariff.days.weekend" as never);
  return days.map((d) => t(`day.${d}` as never)).join(", ");
}

/** Oddiy narx (tejashni ko'rsatish uchun, tarif oynalarisiz) — API `regular_amount` bilan bir xil: ceil(soatlik × daq / 60). */
const regularAmount = (perHour: number, minutes: number) => Math.ceil((perHour * minutes) / 60);

function durationLabel(minutes: number, t: (k: never, v?: Record<string, string | number>) => string) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!m) return t("pkg.hours" as never, { n: h });
  if (!h) return t("pkg.minutes" as never, { n: m });
  return t("pkg.hoursMinutes" as never, { h, m });
}

/** Paket qachon amal qiladi: kunlar + oyna. */
function packageWhen(p: Pick<TariffPackage, "days_of_week" | "start_time" | "end_time">, t: (k: never, v?: Record<string, string | number>) => string) {
  const days = p.days_of_week.length ? daysLabel(p.days_of_week, t) : t("tariff.days.all" as never);
  return p.start_time && p.end_time ? `${days}, ${t("pkg.startBetween" as never, { from: p.start_time, to: p.end_time })}` : days;
}

function Savings({ regular, price }: { regular: number; price: number }) {
  const { t, locale } = useI18n();
  if (regular <= price) return null;
  return <span className="block text-xs font-semibold text-accent">{t("pkg.save", { amount: formatMoney(regular - price, locale) })}</span>;
}

type Refs = { categories: DeviceCategory[]; rooms: Room[]; devices: Device[] };
type Target = "all" | "type" | "category" | "room" | "device";
type RuleDraft = Omit<TariffRule, "price_per_hour"> & { price: string };
type PackageDraft = Omit<TariffPackage, "id" | "price" | "duration_minutes"> & { id?: string; price: string; hours: string; window: boolean };

const PACKAGE_HOURS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12] as const;

function TariffForm({ tariff, refs, onSubmit, onCancel }: { tariff?: Tariff; refs: Refs; onSubmit: (b: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const initialTarget: Target = tariff?.device_id ? "device" : tariff?.room_id ? "room" : tariff?.category_id ? "category" : tariff?.device_type ? "type" : "all";
  const [name, setName] = useState(tariff?.name ?? "");
  const [price, setPrice] = useState(tariff ? tiyinToSomInput(tariff.price_per_hour) : "");
  const [target, setTarget] = useState<Target>(initialTarget);
  const [targetId, setTargetId] = useState(tariff?.device_id ?? tariff?.room_id ?? tariff?.category_id ?? tariff?.device_type ?? "PC");
  const [minM, setMinM] = useState(tariff?.min_minutes ? String(tariff.min_minutes) : "");
  const [maxM, setMaxM] = useState(tariff?.max_minutes ? String(tariff.max_minutes) : "");
  const [priority, setPriority] = useState(String(tariff?.priority ?? 0));
  const [rules, setRules] = useState<RuleDraft[]>(
    tariff?.rules.map((r) => ({ days_of_week: r.days_of_week, start_time: r.start_time, end_time: r.end_time, kind: r.kind, date: r.date?.slice(0, 10) ?? null, price: tiyinToSomInput(r.price_per_hour) })) ?? [],
  );
  const [packages, setPackages] = useState<PackageDraft[]>(
    tariff?.packages?.map((p) => ({
      id: p.id, name: p.name, hours: String(p.duration_minutes / 60), price: tiyinToSomInput(p.price), days_of_week: p.days_of_week,
      start_time: p.start_time, end_time: p.end_time, window: !!p.start_time, is_active: p.is_active,
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setRule = (i: number, patch: Partial<RuleDraft>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setPkg = (i: number, patch: Partial<PackageDraft>) => setPackages((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const base = parseSom(price);
    const ruleRows = rules.map((r) => ({ ...r, price_per_hour: parseSom(r.price) }));
    const pkgRows = packages.map((p) => ({ ...p, priceTiyin: parseSom(p.price) }));
    if (base === null || ruleRows.some((r) => r.price_per_hour === null) || pkgRows.some((p) => p.priceTiyin === null)) {
      setError(t("tariff.badPrice"));
      return;
    }
    if (ruleRows.some((r) => r.days_of_week.length === 0)) {
      setError(t("tariff.pickDays"));
      return;
    }
    setError(null);
    setBusy(true);
    // Maqsad: faqat bittasi to'ldiriladi, qolganlari tahrirda tozalanadi
    const clear = tariff ? null : undefined;
    const body: Record<string, unknown> = {
      name,
      price_per_hour: base,
      priority: Number(priority) || 0,
      device_type: target === "type" ? targetId : clear,
      category_id: target === "category" ? targetId : clear,
      room_id: target === "room" ? targetId : clear,
      device_id: target === "device" ? targetId : clear,
      ...(minM && { min_minutes: Number(minM) }),
      ...(maxM && { max_minutes: Number(maxM) }),
      rules: ruleRows.map((r) => ({ days_of_week: r.days_of_week, start_time: r.start_time, end_time: r.end_time, kind: r.kind, price_per_hour: r.price_per_hour, ...(r.date && { date: r.date }) })),
      packages: pkgRows.map((p) => ({
        ...(p.id && { id: p.id }),
        name: p.name.trim(),
        duration_minutes: Math.round(Number(p.hours) * 60),
        price: p.priceTiyin,
        days_of_week: p.days_of_week,
        start_time: p.window ? p.start_time : null,
        end_time: p.window ? p.end_time : null,
        is_active: p.is_active,
      })),
    };
    await onSubmit(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    setBusy(false);
  }

  const targetOptions: Record<Exclude<Target, "all">, { id: string; name: string }[]> = {
    type: DEVICE_TYPES.map((d) => ({ id: d, name: t(`deviceType.${d}` as never) })),
    category: refs.categories,
    room: refs.rooms,
    device: refs.devices,
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tariff.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("tariff.namePlaceholder")} maxLength={80} required />
        </Field>
        <Field label={t("tariff.basePrice")} hint={t("tariff.somHint")}>
          <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15000" required />
        </Field>
        <Field label={t("tariff.appliesTo")}>
          <Select
            value={target}
            onChange={(e) => {
              const v = e.target.value as Target;
              setTarget(v);
              if (v !== "all") setTargetId(targetOptions[v][0]?.id ?? "");
            }}
          >
            {(["all", "type", "category", "room", "device"] as const).map((k) => (
              <option key={k} value={k} disabled={k !== "all" && targetOptions[k].length === 0}>
                {t(`tariff.target.${k}` as never)}
              </option>
            ))}
          </Select>
        </Field>
        {target !== "all" && (
          <Field label={t(`tariff.target.${target}` as never)}>
            <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
              {targetOptions[target].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t("tariff.minMinutes")}>
          <Input type="number" min={15} step={15} value={minM} onChange={(e) => setMinM(e.target.value)} />
        </Field>
        <Field label={t("tariff.maxMinutes")}>
          <Input type="number" min={15} step={15} value={maxM} onChange={(e) => setMaxM(e.target.value)} />
        </Field>
        <Field label={t("tariff.priority")} hint={t("tariff.priorityHint")}>
          <Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold">{t("tariff.rules")}</div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setRules((rs) => [...rs, { days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: "22:00", end_time: "08:00", kind: "NIGHT", date: null, price: "" }])}
          >
            {t("tariff.addRule")}
          </Button>
        </div>
        <p className="text-xs text-muted">{t("tariff.rulesHint")}</p>
        {rules.map((r, i) => (
          <div key={i} className="space-y-2 rounded-xl bg-surface-2 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <Select className="h-10" value={r.kind} onChange={(e) => setRule(i, { kind: e.target.value })}>
                {RULE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`tariff.kind.${k}` as never)}
                  </option>
                ))}
              </Select>
              <Input className="h-10 w-28" type="time" value={r.start_time} onChange={(e) => setRule(i, { start_time: e.target.value })} required />
              <span className="pb-2 text-muted">—</span>
              <Input className="h-10 w-28" type="time" value={r.end_time} onChange={(e) => setRule(i, { end_time: e.target.value })} required />
              <Input className="h-10 w-32" inputMode="numeric" placeholder={t("tariff.pricePlaceholder")} value={r.price} onChange={(e) => setRule(i, { price: e.target.value })} required />
              {r.kind === "HOLIDAY" && <Input className="h-10 w-40" type="date" value={r.date ?? ""} onChange={(e) => setRule(i, { date: e.target.value || null })} required />}
              <button type="button" className="pb-2 text-sm text-danger-soft" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
                {t("common.delete")}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => {
                const on = r.days_of_week.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setRule(i, { days_of_week: on ? r.days_of_week.filter((x) => x !== d) : [...r.days_of_week, d].sort() })}
                    className={cx("h-8 w-10 rounded-lg text-xs font-bold", on ? "bg-accent text-on-accent" : "border border-line text-muted")}
                  >
                    {t(`day.${d}` as never)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold">{t("pkg.title")}</div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setPackages((ps) => [...ps, { name: t("pkg.hours", { n: 3 }), hours: "3", price: "", days_of_week: [], start_time: "22:00", end_time: "08:00", window: false, is_active: true }])}
          >
            {t("pkg.add")}
          </Button>
        </div>
        <p className="text-xs text-muted">{t("pkg.hint")}</p>
        {packages.map((p, i) => {
          const tiyin = parseSom(p.price);
          const basePrice = parseSom(price);
          return (
            <div key={p.id ?? `new-${i}`} className="space-y-2 rounded-xl bg-surface-2 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Input className="h-10 w-40" value={p.name} onChange={(e) => setPkg(i, { name: e.target.value })} placeholder={t("pkg.namePlaceholder")} maxLength={60} required aria-label={t("pkg.name")} />
                <Select className="h-10" value={p.hours} onChange={(e) => setPkg(i, { hours: e.target.value })} aria-label={t("pkg.duration")}>
                  {PACKAGE_HOURS.map((h) => (
                    <option key={h} value={String(h)}>
                      {durationLabel(h * 60, t)}
                    </option>
                  ))}
                </Select>
                <Input className="h-10 w-32" inputMode="numeric" placeholder={t("pkg.pricePlaceholder")} value={p.price} onChange={(e) => setPkg(i, { price: e.target.value })} required aria-label={t("pkg.price")} />
                <label className="flex h-10 items-center gap-1.5 text-xs font-semibold text-muted">
                  <input type="checkbox" checked={p.is_active} onChange={(e) => setPkg(i, { is_active: e.target.checked })} />
                  {t("pkg.active")}
                </label>
                <button type="button" className="pb-2 text-sm text-danger-soft" onClick={() => setPackages((ps) => ps.filter((_, j) => j !== i))}>
                  {t("common.delete")}
                </button>
              </div>
              {tiyin !== null && basePrice !== null && <Savings regular={regularAmount(basePrice, Number(p.hours) * 60)} price={tiyin} />}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted">{t("pkg.days")}</span>
                {DAYS.map((d) => {
                  const on = p.days_of_week.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setPkg(i, { days_of_week: on ? p.days_of_week.filter((x) => x !== d) : [...p.days_of_week, d].sort() })}
                      className={cx("h-8 w-10 rounded-lg text-xs font-bold", on ? "bg-accent text-on-accent" : "border border-line text-muted")}
                    >
                      {t(`day.${d}` as never)}
                    </button>
                  );
                })}
                {!p.days_of_week.length && <span className="text-xs text-muted">— {t("tariff.days.all")}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                  <input type="checkbox" checked={p.window} onChange={(e) => setPkg(i, { window: e.target.checked })} />
                  {t("pkg.window")}
                </label>
                {p.window && (
                  <>
                    <Input className="h-9 w-28" type="time" value={p.start_time ?? ""} onChange={(e) => setPkg(i, { start_time: e.target.value })} required />
                    <span className="text-muted">—</span>
                    <Input className="h-9 w-28" type="time" value={p.end_time ?? ""} onChange={(e) => setPkg(i, { end_time: e.target.value })} required />
                  </>
                )}
              </div>
              {p.window && <p className="text-xs text-muted">{t("pkg.windowHint")}</p>}
            </div>
          );
        })}
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

/** Narx kalkulyatori: POST /branches/:id/price-quote (PriceEngine). */
function PriceCalculator({ branchId, devices, packages }: { branchId: string; devices: Device[]; packages: TariffPackage[] }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [deviceId, setDeviceId] = useState("");
  const [start, setStart] = useState(() => {
    // Toshkent vaqti bo'yicha keyingi to'liq soat
    const now = new Date(Date.now() + 5 * 3600_000 + 3600_000);
    return now.toISOString().slice(0, 11) + String(now.getUTCHours()).padStart(2, "0") + ":00";
  });
  const [duration, setDuration] = useState("120");
  const [packageId, setPackageId] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = deviceId || devices[0]?.id || "";

  const time = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(11, 16);

  async function calc(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await session.post<Quote>(`/branches/${branchId}/price-quote`, {
        device_ids: [selected],
        start_at: new Date(`${start}:00${TASHKENT_OFFSET}`).toISOString(),
        duration_minutes: Number(duration),
        ...(packageId && { package_id: packageId }),
      });
      setQuote(res.data);
    } catch (err) {
      setQuote(null);
      const code = (err as { code?: string }).code;
      setError(code === "DEVICE_NOT_AVAILABLE" ? t("tariff.noTariffForDevice") : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-fit space-y-4 xl:sticky xl:top-4">
      <div className="font-display text-lg font-bold">{t("quote.title")}</div>
      {devices.length === 0 ? (
        <div className="text-sm text-muted">{t("device.empty")}</div>
      ) : (
        <form onSubmit={calc} className="space-y-3">
          <Field label={t("quote.device")}>
            <Select value={selected} onChange={(e) => setDeviceId(e.target.value)}>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.category ? ` · ${d.category.name}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("quote.start")} hint="Asia/Tashkent">
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          {packages.length > 0 && (
            <Field label={t("pkg.title")}>
              <Select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                <option value="">{t("pkg.none")}</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatMoney(p.price, locale)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("quote.duration")}>
            <Select value={duration} onChange={(e) => setDuration(e.target.value)} disabled={!!packageId}>
              {[60, 120, 180, 240, 300, 360, 480, 600, 720].map((m) => (
                <option key={m} value={m}>
                  {t("quote.hoursN", { n: m / 60 })}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" loading={busy} className="w-full">
            {t("quote.calc")}
          </Button>
        </form>
      )}
      {error && <Alert>{error}</Alert>}
      {quote && (
        <div className="space-y-2 text-sm">
          {quote.items.flatMap((it) =>
            it.segments.map((s, i) => (
              <div key={`${it.device_id}-${i}`} className="flex justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                <span>
                  <span className="font-mono text-xs">
                    {time(s.from)}–{time(s.to)}
                  </span>{" "}
                  <span className="text-muted">{s.rule === "BASE" ? t("tariff.base") : s.rule === "PACKAGE" ? (it.package?.name ?? t("pkg.title")) : t(`tariff.kind.${s.rule}` as never)}</span>
                </span>
                <span className="tabular-nums">{formatMoney(s.amount, locale)}</span>
              </div>
            )),
          )}
          {quote.items.map((it) => it.package && <Savings key={`sv-${it.device_id}`} regular={it.package.regular_amount} price={it.amount} />)}
          {quote.discount > 0 && (
            <div className="flex justify-between text-muted">
              <span>{t("quote.discount")}</span>
              <span>−{formatMoney(quote.discount, locale)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-line-soft pt-2 font-display text-lg font-bold">
            <span>{t("quote.total")}</span>
            <span className="text-accent tabular-nums">{formatMoney(quote.total, locale)}</span>
          </div>
        </div>
      )}
    </Card>
  );
}
