"use client";

import { useState } from "react";
import { LocationPicker } from "@/components/map/location-picker";
import type { LatLng } from "@/components/map/provider";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { Branch } from "@/lib/types";
import { normalizePhone } from "@/lib/use-api";

/** Filial yaratish/tahrirlash formasi. Joylashuv xaritadan tanlanadi (majburiy). */
export function BranchForm({
  clubId,
  branch,
  onSaved,
  onCancel,
  submitLabel,
}: {
  clubId: string;
  branch?: Branch;
  onSaved: (b: Branch) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [name, setName] = useState(branch?.name ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [pos, setPos] = useState<LatLng | null>(branch ? { lat: branch.latitude, lng: branch.longitude } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pos) {
      setError(t("branch.pickLocation"));
      return;
    }
    setBusy(true);
    setError(null);
    const body = { name, address, latitude: pos.lat, longitude: pos.lng, ...(phone ? { phone: normalizePhone(phone) } : {}) };
    try {
      const res = branch ? await session.patch<Branch>(`/branches/${branch.id}`, body) : await session.post<Branch>(`/clubs/${clubId}/branches`, body);
      onSaved(res.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("branch.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required />
        </Field>
        <Field label={t("branch.phone")}>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" />
        </Field>
      </div>
      <Field label={t("branch.location")} hint={t("branch.locationHint")}>
        <LocationPicker
          value={pos}
          onChange={(p, addr) => {
            setPos(p);
            if (addr) setAddress(addr);
          }}
        />
      </Field>
      <Field label={t("branch.address")}>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} minLength={3} maxLength={300} required />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {submitLabel ?? t("common.save")}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
