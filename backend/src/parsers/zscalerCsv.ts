import fs from "fs";
import { parse } from "csv-parse";
import { prisma } from "../db";
import { toBigIntOrNull, toDateOrNull, toInt, deriveUrlParts, truncateToDay, truncateToHour } from "../utils/normalize";

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
  for (const k of keys) if (row[k] !== undefined) return row[k];
  return undefined;
}

export async function parseZscalerCsv(filePath: string, uploadId: string) {
  return new Promise<{ total: number; parsed: number }>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const parser = parse({ columns: true, relax_quotes: true, skip_empty_lines: true, trim: true });

    let total = 0;
    let parsed = 0;
    const batch: any[] = [];
    const BATCH_SIZE = 500;

    function flushBatch() {
      if (batch.length === 0) return Promise.resolve();
      const toInsert = batch.splice(0, batch.length);
      return prisma.event.createMany({ data: toInsert });
    }

    parser.on("readable", async () => {
      let record: Row;
      while ((record = parser.read() as Row) !== null) {
        total++;

        const tsString = pick(record, CANDIDATE_TIME_KEYS);
        const ts = toDateOrNull(tsString);

        const login = pick(record, KEYMAP.login);
        const cip = pick(record, KEYMAP.cip);
        const host = pick(record, KEYMAP.host);
        const url = pick(record, KEYMAP.url);
        const method = pick(record, KEYMAP.method);
        const status = toInt(pick(record, KEYMAP.status));
        const bytesOut = toBigIntOrNull(pick(record, KEYMAP.bytes_out));
        const bytesIn = toBigIntOrNull(pick(record, KEYMAP.bytes_in));
        const ua = pick(record, KEYMAP.useragent);
        const category = pick(record, KEYMAP.category);
        const action = pick(record, KEYMAP.action);
        const country = pick(record, KEYMAP.country);
        const city = pick(record, KEYMAP.city);

        const parts = deriveUrlParts(url || undefined);

        const ev = {
          uploadId,
          ts,
          srcIp: cip || null,
          dstIp: null,
          userName: login || null,
          url: url || null,
          domain: host || parts.host || null,
          method: method || null,
          status: status,
          category: category || null,
          action: action || null,
          bytesIn: bytesIn,
          bytesOut: bytesOut,
          userAgent: ua || null,
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
          extras: record, // keep full row for fidelity
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
