import maxmind from "maxmind";

// avoid strict dependency on the library's types to keep runtime simple
let reader: any = null;
const cache = new Map<string, { country?: string; city?: string; latitude?: number; longitude?: number }>();

export async function initGeoIp() {
  const dbPath = process.env.GEOIP_DB_PATH;
  if (!dbPath) return;
  try {
    reader = await maxmind.open(dbPath);
    console.log("GeoIP DB loaded", dbPath);
  } catch (e: any) {
    console.warn("Failed to load GeoIP DB", e?.message || e);
    reader = null;
  }
}

export function lookupIp(ip?: string | null) {
  if (!ip) return null;
  if (cache.has(ip)) return cache.get(ip) || null;
  if (!reader) return null;
  try {
    const r = reader.get(ip);
    if (!r) return null;
    const country = (r.country && (r.country.iso_code || r.country.names?.en)) || undefined;
    const city = (r.city && (r.city.names?.en || r.city.names?.en)) || undefined;
    const latitude = r.location?.latitude || undefined;
    const longitude = r.location?.longitude || undefined;
    const out = { country, city, latitude, longitude };
    cache.set(ip, out);
    return out;
  } catch (e) {
    return null;
  }
}
