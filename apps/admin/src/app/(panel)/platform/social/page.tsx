"use client";

import { useEffect, useState } from "react";
import { LoadState } from "@/components/status";
import { Alert, Button, Card, Field, Heading, Input } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const KINDS = ["instagram", "telegram", "tiktok", "youtube", "facebook"] as const;
type Kind = (typeof KINDS)[number];
type Social = { links: Partial<Record<Kind, string>>; promo_enabled: boolean };

/** Brend nomlari va namunaviy havolalar — tarjima qilinmaydi. */
const META: Record<Kind, { name: string; example: string }> = {
  instagram: { name: "Instagram", example: "https://instagram.com/zonup.uz" },
  telegram: { name: "Telegram", example: "https://t.me/zonup_uz" },
  tiktok: { name: "TikTok", example: "https://tiktok.com/@zonup.uz" },
  youtube: { name: "YouTube", example: "https://youtube.com/@zonup" },
  facebook: { name: "Facebook", example: "https://facebook.com/zonup.uz" },
};

/** Super admin: platformaning ijtimoiy tarmoqlari va mijozlarga "obuna bo'ling" taklifi. */
export default function PlatformSocialPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const current = useApi<Social>("/admin/settings/social");
  const [links, setLinks] = useState<Record<Kind, string>>({ instagram: "", telegram: "", tiktok: "", youtube: "", facebook: "" });
  const [promo, setPromo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    if (!current.data) return;
    const d = current.data;
    // Server qiymati kelganda formani to'ldiramiz (bir marta)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLinks((l) => Object.fromEntries(KINDS.map((k) => [k, d.links[k] ?? l[k] ?? ""])) as Record<Kind, string>);
    setPromo(d.promo_enabled);
  }, [current.data]);

  const hasLink = KINDS.some((k) => links[k].trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await session.put<Social>("/admin/settings/social", { links: Object.fromEntries(KINDS.map((k) => [k, links[k].trim()])), promo_enabled: promo });
      setPromo(r.data.promo_enabled);
      setMsg({ tone: "success", text: t("common.saved") });
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Heading>{t("social.title")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("social.subtitle")}</p>
      </div>
      <LoadState loading={current.loading} error={current.error} onRetry={current.reload} />
      {current.data && (
        <form onSubmit={save} className="space-y-5">
          <Card className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold">{t("social.links")}</h2>
              <p className="text-xs text-muted">{t("social.linkHint")}</p>
            </div>
            {KINDS.map((k) => (
              <Field key={k} label={META[k].name}>
                <Input type="url" inputMode="url" value={links[k]} placeholder={META[k].example} maxLength={300} onChange={(e) => setLinks((l) => ({ ...l, [k]: e.target.value }))} />
              </Field>
            ))}
          </Card>

          <Card className="space-y-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--color-accent)]" checked={promo && hasLink} disabled={!hasLink} onChange={(e) => setPromo(e.target.checked)} />
              <span>
                <span className="block font-semibold">{t("social.promo")}</span>
                <span className="block text-xs text-muted">{hasLink ? t("social.promoHint") : t("social.needLink")}</span>
              </span>
            </label>
            {promo && hasLink && (
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-widest text-muted">{t("social.preview")}</div>
                <div className="flex flex-col gap-3 rounded-[18px] border border-accent/30 bg-accent/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-display font-bold">{t("social.previewTitle")}</div>
                    <div className="text-sm text-muted">{t("social.previewText")}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {KINDS.filter((k) => links[k].trim()).map((k) => (
                      <span key={k} className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold">
                        {META[k].name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Card>

          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <Button type="submit" loading={busy}>
            {t("common.save")}
          </Button>
        </form>
      )}
    </div>
  );
}
