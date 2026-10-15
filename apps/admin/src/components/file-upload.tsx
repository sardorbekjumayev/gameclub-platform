"use client";

import { Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";

export type UploadedFile = { id: string; mime: string; url: string; public_url: string | null; original_name: string | null };

/** Serverdagi UPLOAD_MAX_MB bilan bir xil (standart 10 MB). */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * O'z storage'imizga fayl yuklash tugmasi (POST /files, docs/01-API.md §6.19):
 * CLUB_MEDIA — logo/muqova (ommaviy `public_url`), CLUB_DOCUMENT — maxfiy hujjat (`id` biriktiriladi).
 */
export function FileUploadButton({
  purpose,
  clubId,
  accept,
  label,
  onUploaded,
  onError,
  disabled,
}: {
  purpose: "CLUB_MEDIA" | "CLUB_DOCUMENT";
  clubId: string;
  accept: string;
  label: string;
  onUploaded: (f: UploadedFile) => void;
  onError: (text: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      onError(t("upload.tooBig"));
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("purpose", purpose);
      form.append("club_id", clubId);
      form.append("file", file);
      onUploaded((await session.post<UploadedFile>("/files", form)).data);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" loading={busy} disabled={disabled} onClick={() => input.current?.click()}>
        {!busy && <Paperclip className="h-4 w-4" />} {label}
      </Button>
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </>
  );
}
