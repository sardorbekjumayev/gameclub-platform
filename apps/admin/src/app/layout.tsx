import type { Metadata } from "next";
import { Chakra_Petch, Manrope } from "next/font/google";
import "./globals.css";
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

export const metadata: Metadata = {
  title: "Zonup",
  description: "Zonup Platform",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uz"
      className={`${manrope.variable} ${chakra.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-fg">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
