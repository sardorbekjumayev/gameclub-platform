"use client";

import { formatDateTime } from "@gc/types";
import { useEffect, useState } from "react";
import { Markdown } from "@/components/markdown";
import { LoadState } from "@/components/status";
import { textarea } from "@/components/support";
import { Alert, Badge, Button, Card, Chip, Field, Heading, Input } from "@/components/ui";
import { LOCALES, type Locale, type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const DOCS = ["offer", "privacy", "terms", "partner"] as const;
type Doc = (typeof DOCS)[number];
type Text = { title: string; body_markdown: string; is_default: boolean };
type AdminLegal = { doc: Doc; version: number; updated_at: string; texts: Record<Locale, Text>; limits: { title_max: number; body_max: number } };
type Draft = { title: string; body: string };

const LANG_NAME: Record<Locale, string> = { uz: "O'zbekcha", ru: "Русский", en: "English" };

/** Super admin: huquqiy hujjatlar matnini tahrirlash (har til alohida saqlanadi; har saqlash — yangi versiya, audit). */
export default function PlatformLegalPage() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [doc, setDoc] = useState<Doc>("offer");
  const [lang, setLang] = useState<Locale>("uz");
  const current = useApi<AdminLegal>(`/admin/legal/${doc}`);
  const data = current.data?.doc === doc ? current.data : null;
  const [drafts, setDrafts] = useState<Partial<Record<Locale, Draft>>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const [filledFor, setFilledFor] = useState<Doc | null>(null);
  useEffect(() => {
    // Hujjat birinchi yuklanganda formani server matni bilan to'ldiramiz (saqlashdan keyin boshqa tillardagi qoralamalar qoladi)
    if (!data || filledFor === data.doc) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(Object.fromEntries(LOCALES.map((l) => [l, { title: data.texts[l].title, body: data.texts[l].body_markdown }])));
    setFilledFor(data.doc);
  }, [data, filledFor]);

  const draft = drafts[lang];
  const dirtyLangs = data ? LOCALES.filter((l) => drafts[l] && (drafts[l]!.title !== data.texts[l].title || drafts[l]!.body !== data.texts[l].body_markdown)) : [];
  const dirty = dirtyLangs.includes(lang);

  function switchDoc(next: Doc) {
    if (next === doc) return;
    if (dirtyLangs.length && !window.confirm(t("legal.unsaved"))) return;
    setMsg(null);
    setDrafts({});
    setFilledFor(null);
    setDoc(next);
  }

  function edit(patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [lang]: { ...d[lang]!, ...patch } }));
    setMsg(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !draft) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await session.put<AdminLegal>(`/admin/legal/${doc}`, { lang, title: draft.title.trim(), body_markdown: draft.body, expected_version: data.version });
      current.setData(r.data);
      // Server trim qilgan sarlavha bilan tenglashtiramiz — "saqlanmagan" belgisi o'chadi
      setDrafts((d) => ({ ...d, [lang]: { title: r.data.texts[lang].title, body: r.data.texts[lang].body_markdown } }));
      setMsg({ tone: "success", text: t("common.saved") });
    } catch (err) {
      const conflict = (err as { code?: string }).code === "CONFLICT";
      setMsg({ tone: "error", text: conflict ? t("legal.conflict") : errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <Heading>{t("legal.title")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("legal.subtitle")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {DOCS.map((d) => (
          <Chip key={d} active={d === doc} onClick={() => switchDoc(d)}>
            {t(`legal.doc.${d}` as MessageKey)}
          </Chip>
        ))}
      </div>

      <LoadState loading={current.loading && !data} error={current.error} onRetry={current.reload} />

      {data && draft && (
        <form onSubmit={save} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {LOCALES.map((l) => (
                <Chip key={l} active={l === lang} onClick={() => setLang(l)}>
                  {LANG_NAME[l]}
                  {dirtyLangs.includes(l) && " •"}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{t("legal.version", { v: data.version, date: formatDateTime(data.updated_at, undefined, locale) })}</span>
              {data.texts[lang].is_default ? <Badge tone="amber">{t("legal.isDefault")}</Badge> : <Badge tone="green">{t("legal.edited")}</Badge>}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-4">
              <Field label={t("legal.docTitle")}>
                <Input value={draft.title} maxLength={data.limits.title_max} onChange={(e) => edit({ title: e.target.value })} required minLength={2} />
              </Field>
              <Field label={t("legal.body")} hint={t("legal.bodyHint")}>
                <textarea
                  className={`${textarea} min-h-[520px] font-mono text-[13px] leading-6`}
                  value={draft.body}
                  maxLength={data.limits.body_max}
                  onChange={(e) => edit({ body: e.target.value })}
                  spellCheck={false}
                  required
                  minLength={20}
                />
              </Field>
              <div className="text-right text-xs tabular-nums text-muted">{t("legal.chars", { n: draft.body.length, max: data.limits.body_max })}</div>
            </Card>

            <Card className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-widest text-muted">{t("legal.preview")}</div>
              <div className="max-h-[680px] overflow-y-auto pr-2">
                <h1 className="font-display text-2xl font-bold">{draft.title}</h1>
                <Markdown source={draft.body} className="mt-4" />
              </div>
            </Card>
          </div>

          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={busy} disabled={!dirty}>
              {t("legal.saveLang", { lang: LANG_NAME[lang] })}
            </Button>
            {dirty && (
              <Button type="button" variant="ghost" onClick={() => edit({ title: data.texts[lang].title, body: data.texts[lang].body_markdown })}>
                {t("legal.reset")}
              </Button>
            )}
            {dirty && <span className="text-xs text-warn">{t("legal.unsaved")}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
