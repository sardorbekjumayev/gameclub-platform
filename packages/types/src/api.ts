/** API javob konverti (docs/01-API.md §3). */
export interface ApiMeta {
  page?: number;
  limit: number;
  total?: number;
  next_cursor?: string | null;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta | null;
  message: string | null;
}

export interface ApiFailure {
  success: false;
  data: null;
  message: string;
  error: { code: string; details: Record<string, unknown>; request_id: string | null };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null | undefined;
  language?: () => 'uz' | 'ru' | 'en';
}

export const isForm = (body: unknown): body is FormData => typeof FormData !== 'undefined' && body instanceof FormData;

export function createApiClient(opts: ApiClientOptions) {
  async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const token = opts.getToken?.();
    const res = await fetch(`${opts.baseUrl}${path}`, {
      method,
      headers: {
        // FormData (fayl yuklash) — Content-Type'ni brauzer o'zi qo'yadi (multipart boundary bilan)
        ...(isForm(body) ? {} : { 'Content-Type': 'application/json' }),
        'Accept-Language': opts.language?.() ?? 'uz',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isForm(body) ? body : JSON.stringify(body),
    });
    const json = (await res.json()) as ApiResponse<T>;
    if (!json.success) {
      throw new ApiError(res.status, json.error.code, json.message, json.error.details, json.error.request_id);
    }
    return json;
  }
  return {
    request,
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body, headers),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
  };
}
