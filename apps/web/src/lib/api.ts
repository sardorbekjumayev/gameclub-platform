import { createApiClient } from "@gc/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4700/api/v1";

export const api = createApiClient({ baseUrl: API_URL });
