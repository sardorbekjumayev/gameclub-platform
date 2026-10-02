"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui";
import { useI18n } from "@/i18n/provider";

type Problem = "insecure" | "noCamera" | "denied" | "failed";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

/** Kamera orqali QR o'qish: BarcodeDetector, bo'lmasa jsQR. Topilgan matn onDecode ga bir marta beriladi. */
export function QrScanner({ onDecode }: { onDecode: (text: string) => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef(onDecode);
  useEffect(() => {
    cb.current = onDecode;
  }, [onDecode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let found = false;

    async function start() {
      if (typeof window === "undefined" || !window.isSecureContext) return setProblem("insecure");
      if (!navigator.mediaDevices?.getUserMedia) return setProblem("noCamera");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (e) {
        const name = (e as { name?: string }).name;
        return setProblem(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "noCamera" : "failed");
      }
      if (stopped) return stream.getTracks().forEach((tr) => tr.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      setReady(true);

      let detector: Detector | null = null;
      const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (Ctor) {
        try {
          const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
          if (formats.includes("qr_code")) detector = new Ctor({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let busy = false;

      const loop = async () => {
        if (stopped || found) return;
        if (!busy && v.readyState >= 2 && v.videoWidth > 0) {
          busy = true;
          try {
            let text: string | null = null;
            if (detector) {
              const r = await detector.detect(v);
              text = r[0]?.rawValue ?? null;
            } else if (jsQR && ctx) {
              const scale = Math.min(1, 640 / v.videoWidth);
              canvas.width = Math.round(v.videoWidth * scale);
              canvas.height = Math.round(v.videoHeight * scale);
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
            if (text && !stopped) {
              found = true;
              stream?.getTracks().forEach((tr) => tr.stop());
              cb.current(text);
              return;
            }
          } catch {
            /* keyingi kadr */
          } finally {
            busy = false;
          }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  if (problem) return <Alert tone="info">{t(`live.scan.${problem}` as never)}</Alert>;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video ref={video} playsInline muted className="aspect-square w-full object-cover" />
      <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-accent/80" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">{t("live.scan.starting")}</div>}
    </div>
  );
}
