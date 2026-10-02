"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { BranchPicker, ClubHeader } from "@/components/club-tabs";
import { HallLayout, type LayoutTile, resolvePositions } from "@/components/hall-layout";
import { Empty, LoadState } from "@/components/status";
import { Alert, Button } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { useMyClub } from "@/lib/my-club";
import { session, useAuth } from "@/lib/session";
import type { Device, DeviceLayout } from "@/lib/types";
import { useApi } from "@/lib/use-api";

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "border-accent text-accent",
  MAINTENANCE: "border-warn text-warn",
  DISABLED: "border-line text-muted opacity-70",
};

/** Zal sxemasi (Phase 3): qurilmalarni grid bo'yicha joylashtirish — PUT /branches/:id/layout. */
export default function LayoutPage() {
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
      {branchId && <BranchLayout key={branchId} branchId={branchId} />}
    </div>
  );
}

function BranchLayout({ branchId }: { branchId: string }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const editable = can("devices.update");
  const devices = useApi<Device[]>(`/branches/${branchId}/devices`);
  const [draft, setDraft] = useState<Record<string, DeviceLayout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const list = devices.data ?? [];
  const tiles: LayoutTile[] = list.map((d) => ({ id: d.id, name: d.name, room: d.room, layout: d.layout ?? null, tone: STATUS_TONE[d.operational_status], sub: t(`status.${d.operational_status}` as never) }));
  const pos = draft ?? resolvePositions(tiles);

  function move(id: string, p: DeviceLayout) {
    const room = list.find((d) => d.id === id)?.room?.id ?? null;
    const next = { ...pos };
    const other = list.find((d) => d.id !== id && (d.room?.id ?? null) === room && next[d.id]?.x === p.x && next[d.id]?.y === p.y);
    if (other) next[other.id] = next[id];
    next[id] = p;
    setDraft(next);
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await session.put(`/branches/${branchId}/layout`, { items: list.map((d) => ({ device_id: d.id, x: pos[d.id].x, y: pos[d.id].y })) });
      setMsg({ tone: "success", text: t("common.saved") });
      setDraft(null);
      devices.reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{editable ? t("layout.hintEdit") : t("layout.hintView")}</p>
        {editable && list.length > 0 && (
          <div className="flex gap-2">
            {draft && (
              <Button variant="secondary" onClick={() => setDraft(null)} disabled={busy}>
                {t("layout.reset")}
              </Button>
            )}
            <Button onClick={save} loading={busy} disabled={!draft && list.every((d) => d.layout)}>
              {t("common.save")}
            </Button>
          </div>
        )}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <LoadState loading={devices.loading && !devices.data} error={devices.error} onRetry={devices.reload} />
      {devices.data && list.length === 0 && <Empty>{t("device.empty")}</Empty>}
      {list.length > 0 && <HallLayout devices={tiles} positions={pos} onMove={editable ? move : undefined} />}
    </div>
  );
}
