"use client";

import { formatMoney } from "@gc/types";
import { useEffect, useState } from "react";
import { Pager, PayoutTable, dayStartIso, todayLocal } from "@/components/analytics";
import { Empty, LoadState } from "@/components/status";
import { Alert, Button, Card, Chip, Field, Heading, Input, Select, Stat } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import type { Payout } from "@/lib/analytics-types";
import { session } from "@/lib/session";
import { idemKey, useApi } from "@/lib/use-api";

const LIMIT = 20;
const STATUSES = ["", "PENDING", "PAID", "CANCELLED"] as const;
type Msg = { tone: "error" | "success" | "info"; text: string } | null;
type ClubOpt = { id: string; name: string };

export default function PlatformPayoutsPage() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("");
  const [clubId, setClubId] = useState("");
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Klub ro'yxati qidiruv orqali (100+ klub bo'lsa ham topiladi)
  const [clubQ, setClubQ] = useState("");
  const [clubQd, setClubQd] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setClubQd(clubQ.trim()), 300);
    return () => clearTimeout(id);
  }, [clubQ]);
  const clubs = useApi<ClubOpt[]>(`/admin/clubs?limit=100${clubQd ? `&q=${encodeURIComponent(clubQd)}` : ""}`);
  const r = useApi<Payout[]>(`/admin/payouts?page=${page}&limit=${LIMIT}${status ? `&status=${status}` : ""}${clubId ? `&club_id=${clubId}` : ""}`);
  const meta = r.meta as { total?: number; summary?: { pending: number; paid: number } } | null;

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: t("common.saved") });
      r.reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <Heading>{t("payout.title")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("payout.subtitle")}</p>
      </div>
      <CalculateForm clubs={clubs.data ?? []} onDone={(m) => (setMsg(m), r.reload())} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {meta?.summary && (
        <div className="grid grid-cols-2 gap-3 md:max-w-xl">
          <Stat label={t("payout.pendingSum")} value={formatMoney(meta.summary.pending, locale)} />
          <Stat label={t("payout.paidSum")} value={formatMoney(meta.summary.paid, locale)} accent />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Chip
            key={s}
            active={status === s}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s ? t(`status.${s}` as MessageKey) : t("moderation.all")}
          </Chip>
        ))}
        <Input className="h-9 w-44 text-sm" placeholder={t("payout.searchClub")} value={clubQ} onChange={(e) => setClubQ(e.target.value)} />
        <Select
          className="h-9 text-sm"
          value={clubId}
          onChange={(e) => {
            setClubId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t("payout.allClubs")}</option>
          {clubs.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <LoadState loading={r.loading} error={r.error} onRetry={r.reload} />
      {r.data?.length === 0 && <Empty>{t("payout.empty")}</Empty>}
      {!!r.data?.length && (
        <PayoutTable
          rows={r.data}
          showClub
          actions={(p) =>
            p.status === "PENDING" && (
              <div className="flex flex-col gap-1.5">
                <Button
                  size="sm"
                  loading={busy === p.id + "paid"}
                  onClick={() => {
                    const reference = prompt(t("payout.referencePrompt"))?.trim();
                    if (reference) act(p.id + "paid", () => session.post(`/admin/payouts/${p.id}/mark-paid`, { reference }, { "Idempotency-Key": idemKey() }));
                  }}
                >
                  {t("payout.markPaid")}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === p.id + "cancel"}
                  onClick={() => confirm(t("payout.confirmCancel")) && act(p.id + "cancel", () => session.post(`/admin/payouts/${p.id}/cancel`, {}, { "Idempotency-Key": idemKey() }))}
                >
                  {t("payout.cancel")}
                </Button>
              </div>
            )
          }
        />
      )}
      <Pager page={page} total={meta?.total ?? 0} limit={LIMIT} onPage={setPage} />
    </div>
  );
}

function CalculateForm({ clubs, onDone }: { clubs: ClubOpt[]; onDone: (m: Msg) => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [from, setFrom] = useState(() => todayLocal(-30));
  const [to, setTo] = useState(() => todayLocal(-1));
  const [clubId, setClubId] = useState("");
  const [busy, setBusy] = useState(false);
  const name = (id: string) => clubs.find((c) => c.id === id)?.name ?? id;

  return (
    <Card className="space-y-3">
      <div className="font-display text-lg font-bold">{t("payout.calculate")}</div>
      <p className="text-sm text-muted">{t("payout.calculateHint")}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const res = await session.post<{ created: number; skipped: { club_id: string; reason: string }[] }>(
              "/admin/payouts/calculate",
              { period_start: dayStartIso(from), period_end: dayStartIso(to, 1), ...(clubId ? { club_id: clubId } : {}) },
              { "Idempotency-Key": idemKey() },
            );
            const skipped = res.data.skipped.map((s) => `${name(s.club_id)} (${s.reason})`).join(", ");
            onDone({ tone: res.data.created ? "success" : "info", text: t("payout.calculated", { n: res.data.created }) + (skipped ? ` ${t("payout.skipped", { list: skipped })}` : "") });
          } catch (err) {
            onDone({ tone: "error", text: errorText(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t("analytics.from")}>
          <Input type="date" className="w-44" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required />
        </Field>
        <Field label={t("analytics.to")}>
          <Input type="date" className="w-44" value={to} min={from} onChange={(e) => setTo(e.target.value)} required />
        </Field>
        <Field label={t("payout.club")}>
          <Select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">{t("payout.allClubs")}</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" loading={busy}>
          {t("payout.calculateBtn")}
        </Button>
      </form>
    </Card>
  );
}
