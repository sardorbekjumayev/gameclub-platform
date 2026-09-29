"use client";

import { createSessionClient, localTokenStore, type LoginResult, type Me } from "@gc/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { API_URL } from "./api";

export const session = createSessionClient({
  baseUrl: API_URL,
  store: localTokenStore(process.env.NEXT_PUBLIC_TOKEN_KEY ?? "gc.tokens"),
  language: () => {
    try {
      return (localStorage.getItem("gc.locale") as "uz" | "ru" | "en") ?? "uz";
    } catch {
      return "uz";
    }
  },
});

const fetchMe = async (): Promise<Me | null> =>
  session.isAuthenticated() ? session.get<Me>("/auth/me").then((r) => r.data, () => null) : null;

type AuthCtx = {
  me: Me | null;
  loading: boolean;
  signIn: (result: LoginResult) => void;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setMe(await fetchMe());
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchMe().then((next) => {
      if (!alive) return;
      setMe(next);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      me,
      loading,
      reload,
      signIn: (r) => {
        session.setTokens({ access_token: r.access_token, refresh_token: r.refresh_token, expires_in: r.expires_in });
        setMe(r.user);
      },
      signOut: async () => {
        await session.logout();
        setMe(null);
      },
      can: (p) => !!me?.permissions.includes(p),
    }),
    [me, loading, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
