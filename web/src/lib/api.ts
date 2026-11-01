// Thin client for the JSON API. Same origin, cookie session: the browser sends the Origin header the server checks.
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Network error');
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON, e.g. a proxy error page */ }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'http_' + res.status, err?.message ?? res.statusText);
  }
  return data as T;
}

export interface User { id: number; email: string; displayName: string; isInstanceAdmin: boolean; uiLocale: string; theme: string; notifyEmail: boolean }
export interface Instance { setupDone: boolean; publicKey: string | null; fingerprint: string | null }
