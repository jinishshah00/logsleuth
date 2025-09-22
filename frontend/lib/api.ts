export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

// typing for the global loader hooks exposed by LoadingShell
declare global {
  interface GlobalThis {
    __LS_loading_start?: () => void;
    __LS_loading_stop?: () => void;
  }
}

// loading shim: the LoadingProvider mounts a pair of start/stop on globalThis for these helpers to call
type LSGlobal = { __LS_loading_start?: () => void; __LS_loading_stop?: () => void };

function startLoading() {
  try { (globalThis as unknown as LSGlobal).__LS_loading_start?.(); } catch { }
}
function stopLoading() {
  try { (globalThis as unknown as LSGlobal).__LS_loading_stop?.(); } catch { }
}

// small helper to extract an Error-like message from unknown values
export function extractErrorMessage(err: unknown): string | null {
  if (typeof err === 'object' && err !== null) {
    const e = err as { message?: unknown };
    if (typeof e.message === 'string') return e.message;
  }
  return null;
}

export async function apiGet<T>(path: string): Promise<T> {
  startLoading();
  try {
    const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
    if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
    return res.json() as Promise<T>;
  } finally {
    stopLoading();
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  startLoading();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body as unknown),
    });
    if (!res.ok) throw new Error(`POST ${path} ${res.status}`);
    return res.json() as Promise<T>;
  } finally {
    stopLoading();
  }
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  startLoading();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      // browser sets multipart boundary header automatically
      credentials: "include",
      body: form,
    });
    if (!res.ok) throw new Error(`POST ${path} ${res.status}`);
    return res.json() as Promise<T>;
  } finally {
    stopLoading();
  }
}

export async function apiDelete<T>(path: string): Promise<T> {
  startLoading();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`DELETE ${path} ${res.status}`);
    return res.json() as Promise<T>;
  } finally {
    stopLoading();
  }
}
