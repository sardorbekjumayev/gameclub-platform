"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { BranchForm } from "@/components/branch-form";
import { ClubHeader } from "@/components/club-tabs";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Alert, Button, Card, Input, Select } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import type { Branch, Room } from "@/lib/types";
import { useApi } from "@/lib/use-api";

const ROOM_TYPES = ["STANDARD", "VIP", "BOOTCAMP", "CONSOLE", "STREAM"] as const;

export default function BranchesPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t } = useI18n();
  const { can } = useAuth();
  const branches = useApi<Branch[]>(`/clubs/${clubId}/branches`);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted">{branches.data && t("clubs.branchesCount", { count: branches.data.length })}</div>
        {can("branches.create") && editing !== "new" && <Button onClick={() => setEditing("new")}>{t("branch.new")}</Button>}
      </div>

      {editing === "new" && (
        <Card>
          <BranchForm
            clubId={clubId}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              branches.reload();
            }}
          />
        </Card>
      )}

      <LoadState loading={branches.loading} error={branches.error} onRetry={branches.reload} />
      {branches.data?.length === 0 && editing !== "new" && <Empty>{t("branch.empty")}</Empty>}

      <div className="space-y-3">
        {branches.data?.map((b) => (
          <Card key={b.id} className="space-y-3">
            {editing === b.id ? (
              <BranchForm
                clubId={clubId}
                branch={b}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  branches.reload();
                }}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-lg font-bold">{b.name}</span>
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="text-sm text-muted">{b.address}</div>
                    {b.phone && <div className="font-mono text-xs text-muted">{b.phone}</div>}
                  </div>
                  <div className="flex gap-2">
                    {can("rooms.view") && (
                      <Button size="sm" variant="secondary" onClick={() => setOpen(open === b.id ? null : b.id)}>
                        {t("room.title")}
                      </Button>
                    )}
                    {can("branches.update") && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(b.id)}>
                        {t("common.edit")}
                      </Button>
                    )}
                    {can("branches.delete") && <DeleteBranch id={b.id} onDone={branches.reload} />}
                  </div>
                </div>
                {open === b.id && <Rooms branchId={b.id} />}
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function DeleteBranch({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="danger"
      loading={busy}
      onClick={async () => {
        if (!confirm(t("branch.confirmDelete"))) return;
        setBusy(true);
        try {
          await session.delete(`/branches/${id}`);
          onDone();
        } catch (err) {
          alert(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("common.delete")}
    </Button>
  );
}

function Rooms({ branchId }: { branchId: string }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const rooms = useApi<Room[]>(`/branches/${branchId}/rooms`);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("STANDARD");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      rooms.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-line-soft pt-3">
      <LoadState loading={rooms.loading} error={rooms.error} onRetry={rooms.reload} />
      {error && <Alert>{error}</Alert>}
      {rooms.data?.length === 0 && <div className="text-sm text-muted">{t("room.empty")}</div>}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.data?.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">
            <div>
              <div className="font-bold">{r.name}</div>
              <div className="text-xs text-muted">
                {t(`room.type.${r.type}` as never)}
                {r.capacity ? ` · ${t("room.capacityN", { n: r.capacity })}` : ""}
              </div>
            </div>
            {can("rooms.delete") && (
              <button
                className="text-xs text-danger-soft hover:underline"
                onClick={() => confirm(t("room.confirmDelete")) && run(() => session.delete(`/rooms/${r.id}`))}
              >
                {t("common.delete")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {can("rooms.create") && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await session.post(`/branches/${branchId}/rooms`, { name, type, ...(capacity && { capacity: Number(capacity) }) });
              setName("");
              setCapacity("");
            });
          }}
        >
          <Input className="max-w-52" placeholder={t("room.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {ROOM_TYPES.map((rt) => (
              <option key={rt} value={rt}>
                {t(`room.type.${rt}` as never)}
              </option>
            ))}
          </Select>
          <Input className="max-w-32" type="number" min={1} max={500} placeholder={t("room.capacity")} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <Button type="submit" variant="secondary" loading={busy}>
            {t("common.add")}
          </Button>
        </form>
      )}
    </div>
  );
}
