export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
// loading shim: the LoadingProvider mounts a pair of start/stop on window for these helpers to call
function startLoading() {
  try { (globalThis as any).__LS_loading_start?.(); } catch (e) {}
}
function stopLoading() {
  try { (globalThis as any).__LS_loading_stop?.(); } catch (e) {}
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

export async function apiPost<T>(path: string, body: any): Promise<T> {
  startLoading();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
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
