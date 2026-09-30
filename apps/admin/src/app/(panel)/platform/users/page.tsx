"use client";

import { formatDateTime } from "@gc/types";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Heading, Input, Select, Spinner } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";

type Row = {
  id: string;
  type: string;
  phone: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
  created_at: string;
  last_login_at: string | null;
};

const LIMIT = 20;

export default function UsersPage() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (query) params.set("q", query);
    if (type) params.set("type", type);
    session.get<Row[]>(`/admin/users?${params}`).then(
      (res) => {
        if (!alive) return;
        setRows(res.data);
        setTotal(res.meta?.total ?? 0);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (!alive) return;
        setError(errorText(e));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [page, query, type, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Filtr/sahifa o'zgarishi — event handler ichida loading yoqiladi. */
  const refetch = (apply: () => void) => {
    setLoading(true);
    apply();
  };

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-4">
      <Heading>{t("users.title")}</Heading>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          refetch(() => {
            setPage(1);
            setQuery(q.trim());
          });
        }}
      >
        <Input className="max-w-xs" placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          value={type}
          onChange={(e) => {
            const v = e.target.value;
            refetch(() => {
              setPage(1);
              setType(v);
            });
          }}
        >
          <option value="">{t("users.filter.all")}</option>
          <option value="CUSTOMER">CUSTOMER</option>
          <option value="STAFF">STAFF</option>
          <option value="PLATFORM">PLATFORM</option>
        </Select>
        <Button type="submit" variant="secondary">
          {t("common.search")}
        </Button>
      </form>

      {error && (
        <Alert>
          {error}{" "}
          <button className="underline" onClick={() => refetch(() => setReloadKey((k) => k + 1))}>
            {t("common.retry")}
          </button>
        </Alert>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line-soft text-xs font-bold uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">{t("users.col.name")}</th>
              <th className="px-4 py-3">{t("users.col.contact")}</th>
              <th className="px-4 py-3">{t("users.col.type")}</th>
              <th className="px-4 py-3">{t("users.col.status")}</th>
              <th className="px-4 py-3">{t("users.col.created")}</th>
              <th className="px-4 py-3">{t("users.col.lastLogin")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  <Spinner className="mx-auto h-5 w-5" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  {t("common.empty")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-line-soft transition last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3">{[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.phone ?? r.email}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.type === "CUSTOMER" ? "neutral" : r.type === "PLATFORM" ? "amber" : "violet"}>{r.type}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={r.status === "ACTIVE" ? "green" : "red"}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(r.created_at, undefined, locale)}</td>
                  <td className="px-4 py-3 text-muted">{r.last_login_at ? formatDateTime(r.last_login_at, undefined, locale) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>{t("common.page", { page, pages })}</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => refetch(() => setPage((p) => p - 1))}>
            {t("common.prev")}
          </Button>
          <Button variant="secondary" disabled={page >= pages} onClick={() => refetch(() => setPage((p) => p + 1))}>
            {t("common.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
