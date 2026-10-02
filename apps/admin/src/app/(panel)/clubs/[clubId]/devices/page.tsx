"use client";

import { formatDateTime } from "@gc/types";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BranchPicker, ClubHeader } from "@/components/club-tabs";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Alert, Button, Card, Field, Input, Select, Stat, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { useMyClub } from "@/lib/my-club";
import { session, useAuth } from "@/lib/session";
import { DEVICE_TYPES, type Device, type DeviceCategory, type Maintenance, type Room } from "@/lib/types";
import { useApi } from "@/lib/use-api";

type Msg = { tone: "error" | "success"; text: string } | null;

export default function DevicesPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t } = useI18n();
  const { branches, loading: clubLoading } = useMyClub(clubId);
  const [picked, setPicked] = useState<string | null>(null);
  const branchId = picked ?? branches[0]?.id ?? null;

  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      {!clubLoading && branches.length === 0 && <Empty>{t("branch.empty")}</Empty>}
      {branches.length > 1 && <BranchPicker branches={branches} value={branchId} onChange={setPicked} />}
      {branchId && <BranchDevices key={branchId} branchId={branchId} />}
    </div>
  );
}

function BranchDevices({ branchId }: { branchId: string }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const devices = useApi<Device[]>(`/branches/${branchId}/devices`);
  const categories = useApi<DeviceCategory[]>(`/branches/${branchId}/device-categories`);
  const rooms = useApi<Room[]>(can("rooms.view") ? `/branches/${branchId}/rooms` : null);
  const maintenance = useApi<Maintenance[]>(`/branches/${branchId}/maintenance`);
  const [panel, setPanel] = useState<"bulk" | "one" | "categories" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [msg, setMsg] = useState<Msg>(null);

  const list = devices.data ?? [];
  const count = (s: string) => list.filter((d) => d.operational_status === s).length;
  const shown = filter ? list.filter((d) => d.operational_status === filter) : list;
  const openTickets = (maintenance.data ?? []).filter((m) => m.status !== "DONE");

  async function run(fn: () => Promise<unknown>, success?: string) {
    setMsg(null);
    try {
      await fn();
      if (success) setMsg({ tone: "success", text: success });
      devices.reload();
      maintenance.reload();
      return true;
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
      return false;
    }
  }

  async function changeStatus(d: Device, status: string) {
    const reason = status === "ACTIVE" ? undefined : prompt(t("device.statusReason")) ?? undefined;
    const body = { operational_status: status, ...(reason && { reason }) };
    setMsg(null);
    try {
      await session.patch(`/devices/${d.id}/status`, body);
    } catch (err) {
      const bookings = (err as { code?: string; details?: { bookings?: unknown[] } }).details?.bookings;
      if ((err as { code?: string }).code === "CONFLICT" && bookings?.length) {
        if (!confirm(t("device.cancelBookingsConfirm", { n: bookings.length }))) return;
        await run(() => session.patch(`/devices/${d.id}/status`, { ...body, resolve: "cancel" }), t("common.saved"));
        return;
      }
      setMsg({ tone: "error", text: errorText(err) });
      return;
    }
    devices.reload();
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("device.total")} value={list.length} />
        <Stat label={t("status.ACTIVE")} value={count("ACTIVE")} accent />
        <Stat label={t("status.MAINTENANCE")} value={count("MAINTENANCE")} />
        <Stat label={t("status.DISABLED")} value={count("DISABLED")} />
      </div>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {["", "ACTIVE", "MAINTENANCE", "DISABLED"].map((s) => (
            <button
              key={s || "all"}
              onClick={() => setFilter(s)}
              className={cx("h-9 rounded-full px-3.5 text-[13px]", filter === s ? "bg-accent font-bold text-on-accent" : "border border-line bg-surface font-semibold")}
            >
              {s ? t(`status.${s}` as never) : t("approvals.all")}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {can("devices.create") && (
            <>
              <Button size="sm" variant={panel === "categories" ? "primary" : "secondary"} onClick={() => setPanel(panel === "categories" ? null : "categories")}>
                {t("device.categories")}
              </Button>
              <Button size="sm" variant={panel === "one" ? "primary" : "secondary"} onClick={() => setPanel(panel === "one" ? null : "one")}>
                {t("device.addOne")}
              </Button>
              <Button size="sm" variant={panel === "bulk" ? "primary" : "secondary"} onClick={() => setPanel(panel === "bulk" ? null : "bulk")}>
                {t("device.addBulk")}
              </Button>
            </>
          )}
        </div>
      </div>

      {panel === "categories" && <Categories branchId={branchId} categories={categories} />}
      {panel === "one" && (
        <Card>
          <DeviceForm
            categories={categories.data ?? []}
            rooms={rooms.data ?? []}
            onCancel={() => setPanel(null)}
            onSubmit={async (body) => (await run(() => session.post(`/branches/${branchId}/devices`, body), t("common.saved"))) && setPanel(null)}
          />
        </Card>
      )}
      {panel === "bulk" && (
        <Card>
          <BulkForm
            categories={categories.data ?? []}
            rooms={rooms.data ?? []}
            onCancel={() => setPanel(null)}
            onSubmit={async (body) =>
              (await run(async () => {
                const r = await session.post<{ created: number }>(`/branches/${branchId}/devices/bulk`, body);
                setMsg({ tone: "success", text: t("device.bulkCreated", { n: r.data.created }) });
              })) && setPanel(null)
            }
          />
        </Card>
      )}

      <LoadState loading={devices.loading} error={devices.error} onRetry={devices.reload} />
      {!devices.loading && list.length === 0 && <Empty>{t("device.empty")}</Empty>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((d) =>
          editing === d.id ? (
            <Card key={d.id} className="sm:col-span-2">
              <DeviceForm
                device={d}
                categories={categories.data ?? []}
                rooms={rooms.data ?? []}
                onCancel={() => setEditing(null)}
                onSubmit={async (body) => (await run(() => session.patch(`/devices/${d.id}`, body), t("common.saved"))) && setEditing(null)}
              />
            </Card>
          ) : (
            <Card key={d.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display text-lg font-bold">{d.name}</div>
                  <div className="text-xs text-muted">
                    {t(`deviceType.${d.type}` as never)}
                    {d.category && ` · ${d.category.name}`}
                    {d.room && ` · ${d.room.name}`}
                  </div>
                </div>
                <StatusBadge status={d.operational_status} />
              </div>
              {specLine(d.specs) && <div className="text-xs text-muted">{specLine(d.specs)}</div>}
              <div className="flex flex-wrap items-center gap-2">
                {can("devices.status.change") && (
                  <Select className="h-9 text-[13px]" value={d.operational_status} onChange={(e) => changeStatus(d, e.target.value)}>
                    {["ACTIVE", "MAINTENANCE", "DISABLED"].map((s) => (
                      <option key={s} value={s}>
                        {t(`status.${s}` as never)}
                      </option>
                    ))}
                  </Select>
                )}
                {can("devices.status.change") && (
                  <button
                    className="text-xs font-semibold text-muted hover:text-fg"
                    onClick={() => {
                      const title = prompt(t("maintenance.titlePrompt"));
                      if (title && title.trim().length >= 2) run(() => session.post(`/devices/${d.id}/maintenance`, { title: title.trim() }), t("maintenance.reported"));
                    }}
                  >
                    {t("maintenance.report")}
                  </button>
                )}
                {can("devices.update") && (
                  <button className="text-xs font-semibold text-muted hover:text-fg" onClick={() => setEditing(d.id)}>
                    {t("common.edit")}
                  </button>
                )}
                {can("devices.delete") && (
                  <button
                    className="text-xs font-semibold text-danger-soft hover:underline"
                    onClick={() => confirm(t("device.confirmDelete", { name: d.name })) && run(() => session.delete(`/devices/${d.id}`))}
                  >
                    {t("common.delete")}
                  </button>
                )}
              </div>
            </Card>
          ),
        )}
      </div>

      <MaintenanceList items={openTickets} loading={maintenance.loading} onUpdate={(id, status) => run(() => session.patch(`/maintenance/${id}`, { status }), t("common.saved"))} />
    </div>
  );
}

const specLine = (s: Device["specs"]) => (s ? [s.cpu, s.gpu, s.ram, s.monitor].filter(Boolean).join(" · ") : "");

type DeviceBody = { name: string; type: string; category_id?: string | null; room_id?: string | null; specs?: Record<string, string> };

function SpecsFields({ specs, onChange }: { specs: Record<string, string>; onChange: (s: Record<string, string>) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {(["cpu", "gpu", "ram", "monitor"] as const).map((k) => (
        <Field key={k} label={t(`device.spec.${k}` as never)}>
          <Input value={specs[k] ?? ""} onChange={(e) => onChange({ ...specs, [k]: e.target.value })} maxLength={60} />
        </Field>
      ))}
    </div>
  );
}

function RefSelects({
  categories,
  rooms,
  categoryId,
  roomId,
  setCategory,
  setRoom,
}: {
  categories: DeviceCategory[];
  rooms: Room[];
  categoryId: string;
  roomId: string;
  setCategory: (v: string) => void;
  setRoom: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t("device.category")}>
        <Select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      {rooms.length > 0 && (
        <Field label={t("device.room")}>
          <Select value={roomId} onChange={(e) => setRoom(e.target.value)}>
            <option value="">—</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );
}

function DeviceForm({
  device,
  categories,
  rooms,
  onSubmit,
  onCancel,
}: {
  device?: Device;
  categories: DeviceCategory[];
  rooms: Room[];
  onSubmit: (b: DeviceBody) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(device?.name ?? "");
  const [type, setType] = useState(device?.type ?? "PC");
  const [categoryId, setCategory] = useState(device?.category_id ?? "");
  const [roomId, setRoom] = useState(device?.room_id ?? "");
  const [specs, setSpecs] = useState<Record<string, string>>((device?.specs as Record<string, string>) ?? {});
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const cleanSpecs = Object.fromEntries(Object.entries(specs).filter(([, v]) => v.trim()));
        // Tahrirda bo'sh tanlov — bog'lanishni olib tashlash (null); yaratishda — maydon yuborilmaydi
        const ref = (v: string) => (v ? v : device ? null : undefined);
        await onSubmit({ name, type, category_id: ref(categoryId), room_id: ref(roomId), specs: cleanSpecs });
        setBusy(false);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("device.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="PC-21" maxLength={40} required />
        </Field>
        <Field label={t("device.type")}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {DEVICE_TYPES.map((d) => (
              <option key={d} value={d}>
                {t(`deviceType.${d}` as never)}
              </option>
            ))}
          </Select>
        </Field>
        <RefSelects categories={categories} rooms={rooms} categoryId={categoryId} roomId={roomId} setCategory={setCategory} setRoom={setRoom} />
      </div>
      <SpecsFields specs={specs} onChange={setSpecs} />
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

function BulkForm({
  categories,
  rooms,
  onSubmit,
  onCancel,
}: {
  categories: DeviceCategory[];
  rooms: Room[];
  onSubmit: (b: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [prefix, setPrefix] = useState("PC-");
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("10");
  const [type, setType] = useState("PC");
  const [categoryId, setCategory] = useState("");
  const [roomId, setRoom] = useState("");
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pad = String(Number(to) || 0).length < 2 ? 2 : String(Number(to)).length;
  const preview = `${prefix}${String(Number(from) || 1).padStart(pad, "0")} … ${prefix}${String(Number(to) || 1).padStart(pad, "0")}`;

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const cleanSpecs = Object.fromEntries(Object.entries(specs).filter(([, v]) => v.trim()));
        await onSubmit({
          prefix,
          from: Number(from),
          to: Number(to),
          type,
          ...(categoryId && { category_id: categoryId }),
          ...(roomId && { room_id: roomId }),
          ...(Object.keys(cleanSpecs).length && { specs: cleanSpecs }),
        });
        setBusy(false);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label={t("device.prefix")}>
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={20} required />
        </Field>
        <Field label={t("device.from")}>
          <Input type="number" min={1} max={999} value={from} onChange={(e) => setFrom(e.target.value)} required />
        </Field>
        <Field label={t("device.to")}>
          <Input type="number" min={1} max={999} value={to} onChange={(e) => setTo(e.target.value)} required />
        </Field>
        <Field label={t("device.type")}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {DEVICE_TYPES.map((d) => (
              <option key={d} value={d}>
                {t(`deviceType.${d}` as never)}
              </option>
            ))}
          </Select>
        </Field>
        <RefSelects categories={categories} rooms={rooms} categoryId={categoryId} roomId={roomId} setCategory={setCategory} setRoom={setRoom} />
      </div>
      <SpecsFields specs={specs} onChange={setSpecs} />
      <div className="text-sm text-muted">{t("device.bulkPreview", { preview })}</div>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {t("device.addBulk")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

function Categories({ branchId, categories }: { branchId: string; categories: ReturnType<typeof useApi<DeviceCategory[]>> }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const [name, setName] = useState("");
  const [type, setType] = useState("PC");
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      categories.reload();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Card className="space-y-3">
      <div className="text-sm text-muted">{t("device.categoriesHint")}</div>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {categories.data?.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm">
            {c.name} <span className="text-xs text-muted">{t(`deviceType.${c.device_type}` as never)}</span>
            {can("devices.delete") && (
              <button className="text-danger-soft" aria-label={t("common.delete")} onClick={() => confirm(t("device.confirmDeleteCategory")) && run(() => session.delete(`/device-categories/${c.id}`))}>
                ×
              </button>
            )}
          </span>
        ))}
        {categories.data?.length === 0 && <span className="text-sm text-muted">{t("common.empty")}</span>}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await session.post(`/branches/${branchId}/device-categories`, { name, device_type: type });
            setName("");
          });
        }}
      >
        <Input className="max-w-56" placeholder={t("device.categoryName")} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {DEVICE_TYPES.map((d) => (
            <option key={d} value={d}>
              {t(`deviceType.${d}` as never)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          {t("common.add")}
        </Button>
      </form>
    </Card>
  );
}

function MaintenanceList({ items, loading, onUpdate }: { items: Maintenance[]; loading: boolean; onUpdate: (id: string, status: string) => void }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  if (loading) return null;
  return (
    <Card className="space-y-3">
      <div className="font-display text-lg font-bold">{t("maintenance.title")}</div>
      {items.length === 0 && <div className="text-sm text-muted">{t("maintenance.empty")}</div>}
      <ul className="space-y-2">
        {items.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">
            <div>
              <div className="font-bold">
                {m.device?.name} — {m.title}
              </div>
              <div className="text-xs text-muted">{formatDateTime(m.created_at, undefined, locale)}</div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={m.status} />
              {can("devices.status.change") && m.status === "OPEN" && (
                <Button size="sm" variant="secondary" onClick={() => onUpdate(m.id, "IN_PROGRESS")}>
                  {t("maintenance.start")}
                </Button>
              )}
              {can("devices.status.change") && (
                <Button size="sm" onClick={() => onUpdate(m.id, "DONE")}>
                  {t("maintenance.done")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
