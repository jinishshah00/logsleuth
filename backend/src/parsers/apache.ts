import fs from "fs";
import readline from "readline";
import { Readable } from "stream";
import { prisma } from "../db";
import { toInt, toBigIntOrNull, deriveUrlParts, truncateToDay, truncateToHour } from "../utils/normalize";
import { lookupIp } from "../services/geoip";

// Example line (combined):
// 127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326 "http://www.example.com/start.html" "Mozilla/4.08 [en] (Win98; I ;Nav)"
const COMBINED =
  /^(?<ip>\S+) \S+ \S+ \[(?<date>[^\]]+)\] "(?<method>\S+)\s(?<path>[^"]*?)\s(?<proto>[^"]+)" (?<status>\d{3}) (?<size>\S+)(?: "(?<ref>[^"]*)" "(?<ua>[^"]*)")?/;

function parseApacheDate(s: string): Date | null {
  // Example: 10/Oct/2000:13:55:36 -0700
  const m = s.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+\-])(\d{2})(\d{2})$/);
  if (!m) return null;
  const [ , dd, mon, yyyy, HH, MM, SS, tzSign, tzh, tzm ] = m;
  const months: Record<string, number> = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  const year = Number(yyyy);
  const month = months[mon];
  const day = Number(dd);
  const hour = Number(HH);
  const min = Number(MM);
  const sec = Number(SS);

  // tz offset minutes
  const offsetMinutes = Number(tzh) * 60 + Number(tzm);
  const offsetSign = tzSign === "-" ? -1 : 1;
  const offset = offsetSign * offsetMinutes;

  // The log time is in local time with the given offset (local = UTC + offset).
  // To get UTC milliseconds: utc = Date.UTC(...) - (offsetMinutes * 60 * 1000)
  const utcMs = Date.UTC(year, month, day, hour, min, sec) - (offset * 60 * 1000);
  return new Date(utcMs);
}

export async function parseApache(stream: Readable, sourceName: string | undefined, uploadId: string) {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let total = 0, parsed = 0;
  const batch: any[] = [];
  const BATCH_SIZE = 500;

  async function flushBatch() {
    if (batch.length === 0) return;
    const toInsert = batch.splice(0, batch.length);
    await prisma.event.createMany({ data: toInsert });
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    total++;
    const m = line.match(COMBINED);
    if (!m || !m.groups) continue;

  const ip = m.groups["ip"];
  const ts = parseApacheDate(m.groups["date"]);
  const method = m.groups["method"];
  const path = m.groups["path"];
  const status = toInt(m.groups["status"]);
  const size = m.groups["size"] || null;
  const ref = m.groups["ref"] || null;
  const ua = m.groups["ua"] || null;

    const parts = deriveUrlParts(path?.startsWith("http") ? path : undefined);

    const geo = lookupIp(ip || undefined);

    const ev = {
      uploadId,
      ts,
      srcIp: ip,
      dstIp: null,
      userName: null,
      url: path.startsWith("http") ? path : null,
      domain: parts.host,
      method,
      status,
      category: null,
      action: null,
      bytesIn: null,
      bytesOut: toBigIntOrNull(size),
      userAgent: ua,
      referrer: ref,
  country: (geo && geo.country) || null,
  city: (geo && geo.city) || null,
  latitude: (geo && geo.latitude) || null,
  longitude: (geo && geo.longitude) || null,
      urlHost: parts.host,
      urlPath: parts.path || (path.startsWith("/") ? path : null),
      urlTld: parts.tld,
      hourBucket: truncateToHour(ts),
      dayBucket: truncateToDay(ts),
      extras: { proto: m.groups["proto"], date: ts ? (new Date(ts)).toISOString().split('T')[0] : null },
      rawLine: line,
    };

    batch.push(ev);
    parsed++;

    if (batch.length >= BATCH_SIZE) {
      await flushBatch();
    }
  }
  await flushBatch();
  return { total, parsed };
}
