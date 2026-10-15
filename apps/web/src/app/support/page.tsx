"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireAuth } from "@/components/require-auth";
import { NewTicketForm, ReplyBadge, TicketStatusBadge } from "@/components/support";
import { Alert, Card, Heading, Spinner } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { fmtDate } from "@/lib/format";
import type { SupportTicket } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export default function SupportPage() {
  return (
    <RequireAuth>
      <Support />
    </RequireAuth>
  );
}

function Support() {
  const { t } = useI18n();
  const router = useRouter();
  const tickets = useApi<SupportTicket[]>("/support/tickets?limit=50");

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 py-8">
      <Link href="/profile" className="text-sm text-muted hover:text-fg">
        ← {t("profile.title")}
      </Link>
      <div>
        <Heading>{t("support.title")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("support.subtitle")}</p>
      </div>
      <Card>
        <h2 className="mb-4 font-display text-lg font-bold">{t("support.new")}</h2>
        <NewTicketForm onCreated={(tk) => router.push(`/support/${tk.id}`)} />
      </Card>

      <h2 className="pt-2 font-display text-lg font-bold">{t("support.mine")}</h2>
      {tickets.loading ? (
        <Spinner className="mx-auto my-8 h-6 w-6" />
      ) : tickets.error ? (
        <Alert>
          {tickets.error}{" "}
          <button className="underline" onClick={tickets.reload}>
            {t("map.retry")}
          </button>
        </Alert>
      ) : tickets.data?.length === 0 ? (
        <Card className="text-center text-sm text-muted">{t("support.empty")}</Card>
      ) : (
        <ul className="space-y-2">
          {tickets.data?.map((tk) => (
            <li key={tk.id}>
              <Link href={`/support/${tk.id}`} className="block rounded-2xl border border-line bg-surface p-4 transition hover:border-muted/60">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">{t(`support.type.${tk.type}` as MessageKey)}</span>
                  <TicketStatusBadge status={tk.status} />
                  <ReplyBadge ticket={tk} />
                  <span className="ml-auto text-xs text-muted">{fmtDate(tk.last_message_at, t as never)}</span>
                </div>
                <div className="mt-1.5 truncate font-semibold">{tk.subject}</div>
                {tk._count && <div className="mt-0.5 text-xs text-muted">{t("support.messages", { n: tk._count.messages })}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
