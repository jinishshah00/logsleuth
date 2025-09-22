// Support either env name: older builds used NEXT_PUBLIC_API_BASE_URL, newer deploys set
// NEXT_PUBLIC_API_BASE. Prefer the new one but fall back to the older name, then to
// localhost for local dev.
// Build-time envs (embedded into the client). We prefer the newer name but fall back
// to the older name. If these are missing or point to localhost (because the image
// was built without the proper env), try a runtime detection so deployed clients
// don't mistakenly call localhost:4000.
const EMBEDDED_API_BASE = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_BASE_URL;

export const API_BASE: string = (() => {
  // If embed exists and isn't a localhost URL, use it.
  if (EMBEDDED_API_BASE && !EMBEDDED_API_BASE.includes("localhost")) return EMBEDDED_API_BASE;

    // Server-side and client-side: prefer the embedded build-time value and
    // otherwise fall back to localhost for development.
    return EMBEDDED_API_BASE || "http://localhost:4000";
})();

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
