"use client";

import { I18nProvider } from "@/i18n/provider";
import { AuthProvider } from "@/lib/session";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <AuthProvider>{children}</AuthProvider>
    </I18nProvider>
  );
}
