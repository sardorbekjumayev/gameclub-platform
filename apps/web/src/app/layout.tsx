import type { Metadata } from "next";
import { Chakra_Petch, Manrope } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/header";
import { SiteFooter } from "@/components/site-footer";
import { Providers } from "./providers";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "600", "700"],
});

const chakra = Chakra_Petch({
  variable: "--font-chakra",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4710";
const DESCRIPTION =
  "Toshkent va butun O'zbekiston bo'ylab kompyuter klublari, PlayStation va VR zallarini toping: bo'sh joylar, narxlar, reyting va onlayn bron bir joyda.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Zonup — kompyuter klub va PlayStation zallarini onlayn bron qiling", template: "%s · Zonup" },
  description: DESCRIPTION,
  keywords: ["Zonup", "zonup.uz", "kompyuter klub", "game club", "PlayStation", "PS5", "VR", "kiberklub", "bron", "Toshkent", "компьютерный клуб", "игровой клуб", "бронирование"],
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "Zonup", locale: "uz_UZ", url: "/", title: "Zonup", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Zonup", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Zonup",
  url: SITE_URL,
  description: DESCRIPTION,
  potentialAction: { "@type": "SearchAction", target: `${SITE_URL}/clubs?q={query}`, "query-input": "required name=query" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uz"
      className={`${manrope.variable} ${chakra.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg pb-20 text-fg md:pb-0">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
        <Providers>
          <Header />
          {children}
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
