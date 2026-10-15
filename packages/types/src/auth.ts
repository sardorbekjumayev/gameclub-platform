import { ApiError, ApiResponse } from './api';

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface MeRole {
  role: string;
  scope_type: 'PLATFORM' | 'CLUB' | 'BRANCH';
  club_id: string | null;
  branch_id: string | null;
}

export interface Me {
  id: string;
  type: 'CUSTOMER' | 'STAFF' | 'PLATFORM';
  phone: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  language: 'uz' | 'ru' | 'en';
  status: string;
  has_password: boolean;
  /** Admin parolni tiklagan — boshqa amallardan oldin yangi parol o'rnatilishi shart. */
  must_change_password: boolean;
  roles: MeRole[];
  permissions: string[];
}

export interface LoginResult extends AuthTokens {
  is_new: boolean;
  must_change_password: boolean;
  user: Me;
}

export interface TokenStore {
  get(): AuthTokens | null;
  set(tokens: AuthTokens | null): void;
}

export function localTokenStore(key: string): TokenStore {
  return {
    get() {
      try {
        const raw = globalThis.localStorage?.getItem(key);
        return raw ? (JSON.parse(raw) as AuthTokens) : null;
      } catch {
        return null;
      }
    },
    set(tokens) {
      try {
        if (tokens) globalThis.localStorage?.setItem(key, JSON.stringify(tokens));
        else globalThis.localStorage?.removeItem(key);
      } catch {
        /* storage mavjud emas */
      }
    },
  };
}

/**
 * Bearer token bilan so'rov; `TOKEN_EXPIRED`/401 bo'lsa bir marta refresh qilib qayta yuboradi.
 * Parallel so'rovlar bitta refresh'ni kutadi (rotation reuse'ga tushib qolmaslik uchun).
 */
export function createSessionClient(opts: {
  baseUrl: string;
  store: TokenStore;
  language?: () => 'uz' | 'ru' | 'en';
  onLogout?: () => void;
}) {
  let refreshing: Promise<AuthTokens | null> | null = null;

  async function raw<T>(method: string, path: string, body: unknown, token?: string, headers: Record<string, string> = {}) {
    const res = await fetch(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': opts.language?.() ?? 'uz',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
    if (!json) throw new ApiError(res.status, 'NETWORK_ERROR', res.statusText);
    if (!json.success) throw new ApiError(res.status, json.error.code, json.message, json.error.details, json.error.request_id);
    return json;
  }

  async function refresh(): Promise<AuthTokens | null> {
    const current = opts.store.get();
    if (!current) return null;
    refreshing ??= raw<AuthTokens>('POST', '/auth/refresh', { refresh_token: current.refresh_token })
      .then((r) => {
        opts.store.set(r.data);
        return r.data;
      })
      .catch(() => {
        opts.store.set(null);
        opts.onLogout?.();
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
    const token = opts.store.get()?.access_token;
    try {
      return await raw<T>(method, path, body, token, headers);
    } catch (e) {
      if (token && e instanceof ApiError && e.status === 401) {
        const next = await refresh();
        if (next) return raw<T>(method, path, body, next.access_token, headers);
      }
      throw e;
    }
  }

  return {
    request,
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body, headers),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
    isAuthenticated: () => !!opts.store.get(),
    /** WebSocket handshake uchun joriy access token. */
    accessToken: () => opts.store.get()?.access_token ?? null,
    /** Token muddati tugaganda (masalan WebSocket rad etsa) yangilash. */
    refresh: async () => (await refresh())?.access_token ?? null,
    setTokens: (t: AuthTokens | null) => opts.store.set(t),
    async logout() {
      const current = opts.store.get();
      if (current) await request('POST', '/auth/logout', { refresh_token: current.refresh_token }).catch(() => undefined);
      opts.store.set(null);
    },
  };
}

export type SessionClient = ReturnType<typeof createSessionClient>;

export const hasPermission = (me: Me | null | undefined, permission: string) => !!me?.permissions.includes(permission);

/** `POST /auth/send-otp` javobi: kod Telegram bot orqali keladi (bog'lanmagan bo'lsa — `bot_url`). */
export type SendOtpResult =
  | { channel: 'TELEGRAM' | 'DEV'; delivered: true; expires_in: number; resend_in: number }
  | { channel: 'TELEGRAM'; delivered: false; bot_url: string; link_expires_in: number; resend_in: number };
