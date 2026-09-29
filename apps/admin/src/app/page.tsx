import { api } from "@/lib/api";
import { getT } from "@/i18n";

export const dynamic = "force-dynamic";

async function apiReady() {
  try {
    const res = await api.get<{ status: string }>("/health/ready");
    return res.data.status === "ok";
  } catch {
    return false;
  }
}

export default async function Home() {
  const t = getT();
  const ok = await apiReady();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold">{t("app.title")}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">{t("app.tagline")}</p>
      <p className="text-sm">
        {t("system.api")}:{" "}
        <span className={ok ? "text-emerald-600" : "text-red-600"}>
          {ok ? t("system.ok") : t("system.down")}
        </span>
      </p>
    </main>
  );
}
