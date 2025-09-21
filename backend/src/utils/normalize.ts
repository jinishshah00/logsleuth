import { URL } from "url";

export function toInt(s: any): number | null {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function toBigIntOrNull(s: any): bigint | null {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  if (str === "" || str === "-") return null;
  // remove common thousands separators and spaces
  const cleaned = str.replace(/[, ]/g, "");
  // allow optional leading + or - and digits
  if (!/^[+-]?\d+$/.test(cleaned)) return null;
  try {
    return BigInt(cleaned);
  } catch {
    return null;
  }
}

export function toDateOrNull(s: any): Date | null {
  if (!s) return null;
  // try ISO first
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

export function deriveUrlParts(urlStr?: string | null) {
  if (!urlStr) return { host: null as string | null, path: null as string | null, tld: null as string | null };
  try {
    const u = new URL(urlStr);
    const host = u.hostname || null;
    const path = u.pathname || null;
    const tld = host ? host.split(".").pop() || null : null;
    return { host, path, tld };
  } catch {
    return { host: null, path: null, tld: null };
  }
}

export function truncateToHour(d: Date | null): Date | null {
  if (!d) return null;
  const t = new Date(d);
  t.setMinutes(0, 0, 0);
  return t;
}

export function truncateToDay(d: Date | null): Date | null {
  if (!d) return null;
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t;
}
