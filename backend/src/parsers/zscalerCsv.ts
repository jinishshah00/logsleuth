import fs from "fs";
import { parse } from "csv-parse";
import { prisma } from "../db";
import { toBigIntOrNull, toDateOrNull, toInt, deriveUrlParts, truncateToDay, truncateToHour } from "../utils/normalize";
import { inferCsvMapping } from "./schemaDetect";

type Row = Record<string, string>;

const CANDIDATE_TIME_KEYS = ["time", "datetime", "timestamp"];
const KEYMAP = {
  login: ["login", "user", "username"],
  cip: ["cip", "src_ip", "source_ip", "clientip"],
  host: ["host", "domain"],
  url: ["url"],
  method: ["method", "reqmethod", "http_method"],
  status: ["status", "respcode", "status_code"],
  bytes_out: ["bytes_out", "bytesout", "reqsize", "sentbytes"],
  bytes_in: ["bytes_in", "bytesin", "respsize", "recvbytes"],
  useragent: ["useragent", "ua"],
  category: ["category", "categories"],
  action: ["action", "decision"],
  country: ["country"],
  city: ["city"],
};

function pick(row: Row, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    // treat null/undefined/empty-string as missing
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function looksLikeUrl(s?: string | undefined): boolean {
  if (!s) return false;
  // quick URL heuristics: starts with protocol OR contains a slash with a dot (host/path)
  return /^https?:\/\//i.test(s) || /\/[\w\-_.~%!$&'()*+,;=:@]/.test(s) || /^[\w.-]+\.[a-z]{2,}/i.test(s);
}

function isLikelyUserAgent(s?: string | undefined): boolean {
  if (!s) return false;
  // UA strings often contain product/version pairs and parentheses
  // and are usually relatively long (> 20 chars). This is heuristic.
  if (s.length < 10) return false;
  const uaSignals = /\b(Mozilla|AppleWebKit|Chrome|Safari|Firefox|Opera|PostmanRuntime|curl|Python-requests|Java|okhttp)\b/i;
  if (uaSignals.test(s)) return true;
  // many UAs contain a slash followed by a version like Chrome/119
  if (/\/[0-9]+/.test(s) && /[()]/.test(s)) return true;
  return false;
}

function looksLikeDomain(s?: string | undefined): boolean {
  if (!s) return false;
  // domain should not contain spaces or parentheses and usually contains at least one dot
  if (/[\s()]/.test(s)) return false;
  // allow bare hosts like example.com or host.sub
  return /^[\w.-]+\.[a-z]{2,}/i.test(s) || /^\d+\.\d+\.\d+\.\d+$/.test(s);
}

export async function parseZscalerCsv(filePath: string, uploadId: string) {
  return new Promise<{ total: number; parsed: number }>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const parser = parse({ columns: true, relax_quotes: true, skip_empty_lines: true, trim: true });

  let total = 0;
  let parsed = 0;
  const batch: any[] = [];
  const BATCH_SIZE = 500;

  // sample headers + rows for mapping inference
  const SAMPLE_ROWS: Row[] = [];
  const SAMPLE_LIMIT = 30;
  let headersSeen: string[] | null = null;

    function flushBatch() {
      if (batch.length === 0) return Promise.resolve();
      const toInsert = batch.splice(0, batch.length);
      return prisma.event.createMany({ data: toInsert });
    }

    parser.on("readable", async () => {
      let record: Row;
      while ((record = parser.read() as Row) !== null) {
        total++;

        // record headers for inference
        if (!headersSeen) headersSeen = Object.keys(record);
        if (SAMPLE_ROWS.length < SAMPLE_LIMIT) SAMPLE_ROWS.push(record);

        // once we have a small sample, infer mapping
        if (total === SAMPLE_LIMIT && headersSeen) {
          try {
            const { mapping, confidence } = inferCsvMapping(headersSeen, SAMPLE_ROWS as Row[]);
            // if confident, remap KEYMAP-like picks to detected headers
            if (confidence > 0.45) {
                // create a dynamic pick function that accepts the current row
                const mapPick = (r: Row, role: string) => {
                  const h = (mapping as any)[role];
                  if (!h) return undefined;
                  const val = (r as any)[h];
                  return val !== undefined && val !== null && val !== "" ? val : undefined;
                };
                // store detected picker; it will be called with (row, role)
                (pick as any).detected = mapPick;
              }
          } catch (e) {
            // inference failed; ignore
          }
        }

        const getField = (role: string) => {
          if ((pick as any).detected) return (pick as any).detected(record, role);
          const keys = (KEYMAP as any)[role];
          if (!keys) return undefined;
          return pick(record, keys as string[]);
        };

        const tsString = (getField('time') as string | undefined) || pick(record, CANDIDATE_TIME_KEYS) as string | undefined;
        const ts = toDateOrNull(tsString);

        const login = getField('login');
        const cip = getField('cip');
        const host = getField('host');
        const url = getField('url');
        const method = getField('method');
        const status = toInt(getField('status'));
        const bytesOut = toBigIntOrNull(getField('bytes_out'));
        const bytesIn = toBigIntOrNull(getField('bytes_in'));
        const ua = pick(record, KEYMAP.useragent);
        const category = pick(record, KEYMAP.category);
        const action = pick(record, KEYMAP.action);
        const country = pick(record, KEYMAP.country);
        const city = pick(record, KEYMAP.city);

        // Heuristic selection: prefer URL-like values for URL, prefer UA-like for userAgent
        let chosenUrl = url;
        let chosenHost = host;
        let chosenUA = ua;

        // If url is missing but host looks like a UA, move it to UA
        if ((!chosenUrl || chosenUrl === "") && chosenHost && isLikelyUserAgent(chosenHost)) {
          chosenUA = chosenHost;
          chosenHost = undefined as any;
        }

        // If url looks like UA, move to UA and clear url
        if (chosenUrl && isLikelyUserAgent(chosenUrl)) {
          chosenUA = chosenUrl;
          chosenUrl = undefined as any;
        }

        // If url is not URL-like but UA-like, treat as UA
        if (chosenUrl && (!looksLikeUrl(chosenUrl) || /[\s()]/.test(chosenUrl)) && isLikelyUserAgent(chosenUrl)) {
          chosenUA = chosenUrl;
          chosenUrl = undefined as any;
        }

        // If host looks like a domain (no spaces and contains dot) prefer it as domain
        if (!chosenUrl && chosenHost && looksLikeDomain(chosenHost)) {
          // leave chosenHost as domain (we'll prefer parts.host from URL when present)
        } else if (!chosenUrl && chosenHost && looksLikeUrl(chosenHost)) {
          // host might contain a path; promote to URL
          chosenUrl = chosenHost;
          chosenHost = undefined as any;
        } else if (chosenHost && isLikelyUserAgent(chosenHost)) {
          // if host looks like UA, move it
          chosenUA = chosenHost;
          chosenHost = undefined as any;
        }

        const parts = deriveUrlParts(chosenUrl || undefined);

        const ev = {
          uploadId,
          ts,
          srcIp: cip || null,
          dstIp: null,
          userName: login || null,
          url: chosenUrl || null,
          domain: chosenHost || parts.host || null,
          method: method || null,
          status: status,
          category: category || null,
          action: action || null,
          bytesIn: bytesIn,
          bytesOut: bytesOut,
          userAgent: chosenUA || null,
          referrer: null,
          country: country || null,
          city: city || null,
          latitude: null,
          longitude: null,
          urlHost: parts.host,
          urlPath: parts.path,
          urlTld: parts.tld,
          hourBucket: truncateToHour(ts),
          dayBucket: truncateToDay(ts),
          extras: { ...record, date: ts ? (new Date(ts)).toISOString().split('T')[0] : null }, // keep full row and add date
          rawLine: JSON.stringify(record),
        };

        batch.push(ev);
        parsed++;

        if (batch.length >= BATCH_SIZE) {
          parser.pause();
          await flushBatch();
          parser.resume();
        }
      }
    });

    parser.on("end", async () => {
      try {
        await flushBatch();
        resolve({ total, parsed });
      } catch (e) {
        reject(e);
      }
    });

    parser.on("error", (err) => reject(err));

    stream.pipe(parser);
  });
}
