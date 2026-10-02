import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4710";
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4700";

export const revalidate = 3600;

/** Ommaviy sahifalar + barcha faol filiallar (qidiruv tizimlari klublarni topishi uchun). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/clubs`, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/map`, changeFrequency: "daily", priority: 0.7 },
  ];
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/discovery/search?limit=100`, { next: { revalidate } });
    const body = (await res.json()) as { data?: { id: string }[] };
    for (const b of body.data ?? []) pages.push({ url: `${SITE_URL}/clubs/${b.id}`, changeFrequency: "weekly", priority: 0.8 });
  } catch {
    // API ishlamasa ham statik sahifalar qaytadi
  }
  return pages;
}
