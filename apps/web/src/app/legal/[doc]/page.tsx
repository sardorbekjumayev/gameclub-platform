import type { Metadata } from "next";
import { notFound } from "next/navigation";
import uz from "@/i18n/messages/uz.json";
import { type LegalDocData, type LegalLang, isLegalDoc } from "@/lib/legal";
import { LegalView } from "./legal-view";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4700";
const LANGS: LegalLang[] = ["uz", "ru", "en"];

// Matn kamdan-kam o'zgaradi: 5 daqiqalik kesh (tahrirdan keyin ko'pi bilan 5 daq eski matn)
export const revalidate = 300;

async function load(doc: string, lang: LegalLang): Promise<LegalDocData | null> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/legal/${doc}?lang=${lang}`, { next: { revalidate } });
    if (!res.ok) return null;
    return ((await res.json()) as { data: LegalDocData }).data;
  } catch {
    // API ishlamasa — klient o'zi qayta so'raydi
    return null;
  }
}

export async function generateMetadata({ params }: PageProps<"/legal/[doc]">): Promise<Metadata> {
  const { doc } = await params;
  if (!isLegalDoc(doc)) return {};
  const d = await load(doc, "uz");
  const title = d?.title ?? uz[`legal.${doc}`];
  const description = uz[`legal.desc.${doc}`];
  return {
    title,
    description,
    alternates: { canonical: `/legal/${doc}` },
    openGraph: { type: "article", url: `/legal/${doc}`, title, description },
  };
}

/** Server'da render qilinadi (SEO uchun uz matni HTML'da bo'ladi); til almashtirilganda klient tegishli matnni ko'rsatadi. */
export default async function LegalPage({ params }: PageProps<"/legal/[doc]">) {
  const { doc } = await params;
  if (!isLegalDoc(doc)) notFound();
  const docs = await Promise.all(LANGS.map((l) => load(doc, l)));
  const initial = Object.fromEntries(LANGS.map((l, i) => [l, docs[i]])) as Record<LegalLang, LegalDocData | null>;
  return <LegalView doc={doc} initial={initial} />;
}
