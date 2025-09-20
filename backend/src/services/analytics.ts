import { prisma } from "../db";
import { Prisma } from "@prisma/client";

export async function getSummary(uploadId: string, bucketMinutes = 5) {
  const where = { uploadId } satisfies Prisma.EventWhereInput;

  // ensure bucketMinutes is one of allowed values at service level too
  const allowed = new Set([1,5,10,15,30,60]);
  if (!allowed.has(bucketMinutes)) bucketMinutes = 5;

  // build SQL snippet for dynamic bucket size (bucketMinutes is validated above)
  const bucketExpr = `date_trunc('hour', "ts") + floor(extract(minute from "ts")/${bucketMinutes})*interval '${bucketMinutes} minutes'`;

  const [total, topSrcIp, topDomains, statusCounts, methodCounts, bytesAgg, series] =
    await Promise.all([
      prisma.event.count({ where }),

      prisma.$queryRaw<{ src_ip: string; c: bigint }[]>`
        SELECT "srcIp" as src_ip, COUNT(*)::bigint c
        FROM "Event"
        WHERE "uploadId" = ${uploadId} AND "srcIp" IS NOT NULL
        GROUP BY "srcIp"
        ORDER BY c DESC
        LIMIT 10
      `,

      prisma.$queryRaw<{ domain: string; c: bigint }[]>`
        SELECT "domain", COUNT(*)::bigint c
        FROM "Event"
        WHERE "uploadId" = ${uploadId} AND "domain" IS NOT NULL
        GROUP BY "domain"
        ORDER BY c DESC
        LIMIT 10
      `,

      prisma.$queryRaw<{ status: number; c: bigint }[]>`
        SELECT "status", COUNT(*)::bigint c
        FROM "Event"
        WHERE "uploadId" = ${uploadId}
        GROUP BY "status"
        ORDER BY c DESC
      `,

      prisma.$queryRaw<{ method: string; c: bigint }[]>`
        SELECT "method", COUNT(*)::bigint c
        FROM "Event"
        WHERE "uploadId" = ${uploadId}
        GROUP BY "method"
        ORDER BY c DESC
      `,

      prisma.$queryRaw<{ 
        bytes_out_sum: string|null,
        bytes_in_sum: string|null,
        bytes_out_p50: string|null,
        bytes_out_p90: string|null,
        bytes_out_p99: string|null
      }[]>`
        SELECT
          SUM("bytesOut")::text as bytes_out_sum,
          SUM("bytesIn")::text  as bytes_in_sum,
          percentile_cont(0.5) within group (order by "bytesOut")::text as bytes_out_p50,
          percentile_cont(0.9) within group (order by "bytesOut")::text as bytes_out_p90,
          percentile_cont(0.99) within group (order by "bytesOut")::text as bytes_out_p99
        FROM "Event"
        WHERE "uploadId" = ${uploadId} AND "bytesOut" IS NOT NULL
      `,

      prisma.$queryRaw<{ bucket: Date; c: bigint }[]>(
        Prisma.sql`
          SELECT (${Prisma.raw(bucketExpr)}) as bucket, COUNT(*)::bigint c
          FROM "Event"
          WHERE "uploadId" = ${uploadId} AND "ts" IS NOT NULL
          GROUP BY bucket
          ORDER BY bucket ASC
        `
      ),
    ]);

  return {
    total,
    topSrcIp,
    topDomains,
    statusCounts,
    methodCounts,
    bytes: (bytesAgg[0] ?? {
      bytes_out_sum: null, bytes_in_sum: null,
      bytes_out_p50: null, bytes_out_p90: null, bytes_out_p99: null
    }),
    series,
  };
}

export type EventsQuery = {
  page?: number; pageSize?: number;
  srcIp?: string;
  domain?: string;
  status?: string; // comma list
  method?: string; // comma list
  timeFrom?: string; // ISO
  timeTo?: string;   // ISO
  search?: string;   // naive substring on url/domain/userAgent
};

export async function listEvents(uploadId: string, q: EventsQuery) {
  const page = Math.max(1, Number(q.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize || 25)));
  const skip = (page - 1) * pageSize;

  const where: Prisma.EventWhereInput = { uploadId };

  if (q.srcIp) where.srcIp = q.srcIp;
  if (q.domain) where.domain = { contains: q.domain, mode: "insensitive" };
  if (q.status) {
    const nums = q.status.split(",").map(s => Number(s)).filter(n => Number.isFinite(n));
    if (nums.length) where.status = { in: nums as any };
  }
  if (q.method) {
    const arr = q.method.split(",").map(s => s.trim()).filter(Boolean);
    if (arr.length) where.method = { in: arr };
  }
  if (q.timeFrom || q.timeTo) {
    where.ts = {};
    if (q.timeFrom) (where.ts as any).gte = new Date(q.timeFrom);
    if (q.timeTo)   (where.ts as any).lte = new Date(q.timeTo);
  }
  if (q.search) {
    where.OR = [
      { url: { contains: q.search, mode: "insensitive" } },
      { domain: { contains: q.search, mode: "insensitive" } },
      { userAgent: { contains: q.search, mode: "insensitive" } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: [{ ts: "asc" }, { id: "asc" }],
      skip, take: pageSize,
      select: {
        id: true, ts: true, srcIp: true, userName: true, url: true, domain: true,
        method: true, status: true, category: true, action: true, bytesOut: true, bytesIn: true,
        userAgent: true, urlHost: true, urlPath: true, urlTld: true
      }
    })
  ]);

  // normalize items: add `date` (ISO YYYY-MM-DD) and coerce bytes to numbers when possible
  const mapped = items.map((it: any) => {
    const date = it.ts ? (new Date(it.ts)).toISOString().split("T")[0] : null;
    const bytesOut = it.bytesOut == null ? null : (typeof it.bytesOut === "bigint" ? Number(it.bytesOut) : Number(it.bytesOut));
    const bytesIn = it.bytesIn == null ? null : (typeof it.bytesIn === "bigint" ? Number(it.bytesIn) : Number(it.bytesIn));
    return { ...it, date, bytesOut, bytesIn };
  });

  return { total, page, pageSize, items: mapped };
}

export async function getTimeline(uploadId: string, limit = 200) {
  // simplest: first N ordered events with key fields
  const items = await prisma.event.findMany({
    where: { uploadId },
    orderBy: [{ ts: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true, ts: true, srcIp: true, userName: true, domain: true, url: true,
      method: true, status: true, category: true, action: true, bytesOut: true, bytesIn: true, urlPath: true
    }
  });

  const mapped = items.map((it: any) => {
    const date = it.ts ? (new Date(it.ts)).toISOString().split("T")[0] : null;
    const bytesOut = it.bytesOut == null ? null : (typeof it.bytesOut === "bigint" ? Number(it.bytesOut) : Number(it.bytesOut));
    const bytesIn = it.bytesIn == null ? null : (typeof it.bytesIn === "bigint" ? Number(it.bytesIn) : Number(it.bytesIn));
    return { ...it, date, bytesOut, bytesIn };
  });

  return { items: mapped, limit };
}