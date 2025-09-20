import { prisma } from "../db";
import { Prisma } from "@prisma/client";

// 5-minute bucket
const BUCKET_5M = `
  date_trunc('hour', "ts") + floor(extract(minute from "ts")/5)*interval '5 minutes'
`;

type Anom = {
  detector: string;
  reasonText: string;
  confidence: number; // 0..1
  eventId?: number | null;
};

// helpers
function zScore(x: number, mean: number, stdev: number) {
  if (!isFinite(stdev) || stdev === 0) return 0;
  return (x - mean) / stdev;
}
function confFromZ(z: number, cap = 6) {
  const v = Math.min(Math.abs(z), cap) / cap;
  return Math.max(0.1, Number(v.toFixed(2)));
}

/**
 * Run all detectors for a given upload. This clears existing anomalies and re-computes them.
 * Returns counts per detector.
 */
export async function runAnomalyDetection(uploadId: string) {
  await prisma.anomaly.deleteMany({ where: { uploadId } });

  const results: Record<string, number> = {};

  // D1: Rate spike per srcIp OR userName (5-minute buckets vs that actor's mean/std)
  results["D1_rate_spike"] = await d1_rateSpike(uploadId);

  // D2: Rare domain in this upload (low frequency)
  results["D2_rare_domain"] = await d2_rareDomain(uploadId);

  // D3: High error ratio per actor (status >= 400)
  results["D3_error_ratio"] = await d3_errorRatio(uploadId);

  // D4: Data egress outliers (very large bytesOut)
  results["D4_egress_outlier"] = await d4_egressOutlier(uploadId);

  // D5: Impossible travel (same user, different country within short window)
  results["D5_impossible_travel"] = await d5_impossibleTravel(uploadId);

  return results;
}

/* -------------------- D1 -------------------- */
async function d1_rateSpike(uploadId: string) {
  // Build actor as COALESCE(userName, srcIp)
  const rows = await prisma.$queryRaw<{
    actor: string | null; bucket: Date; c: bigint;
  }[]>`
    SELECT COALESCE("userName","srcIp") as actor,
           (${Prisma.raw(BUCKET_5M)}) as bucket,
           COUNT(*)::bigint as c
    FROM "Event"
    WHERE "uploadId" = ${uploadId} AND "ts" IS NOT NULL
    GROUP BY actor, bucket
    HAVING COALESCE("userName","srcIp") IS NOT NULL
    ORDER BY actor, bucket
  `;

  // group per actor, compute mean/std, flag buckets with z > 3
  const byActor = new Map<string, { bucket: Date; c: number }[]>();
  rows.forEach(r => {
    const a = r.actor!;
    if (!byActor.has(a)) byActor.set(a, []);
    byActor.get(a)!.push({ bucket: r.bucket, c: Number(r.c) });
  });

  let count = 0;
  for (const [actor, arr] of byActor) {
    const vals = arr.map(x => x.c);
    const mean = vals.reduce((a,b)=>a+b,0) / vals.length;
    const variance = vals.reduce((s,x)=>s + Math.pow(x-mean,2),0) / Math.max(vals.length-1,1);
    const stdev = Math.sqrt(variance);

    // find events in spike buckets and create anomalies pointing to the first event in bucket
    for (const b of arr) {
      const z = zScore(b.c, mean, stdev);
      if (z > 3) {
        const ev = await prisma.event.findFirst({
          where: {
            uploadId,
            ts: { gte: b.bucket, lt: new Date(new Date(b.bucket).getTime() + 5*60*1000) },
            OR: [{ userName: actor }, { srcIp: actor }]
          },
          orderBy: [{ ts: "asc" }, { id: "asc" }],
          select: { id: true }
        });
        await prisma.anomaly.create({
          data: {
            uploadId,
            eventId: ev?.id ?? null,
            detector: "D1_rate_spike",
            reasonText: `Spike for actor=${actor} count=${b.c} vs mean≈${mean.toFixed(1)} (z=${z.toFixed(2)})`,
            confidence: confFromZ(z)
          }
        });
        count++;
      }
    }
  }
  return count;
}

/* -------------------- D2 -------------------- */
async function d2_rareDomain(uploadId: string) {
  const totals = await prisma.event.count({ where: { uploadId } });
  if (totals === 0) return 0;

  const rows = await prisma.$queryRaw<{ domain: string; c: bigint; event_id: number|null }[]>`
    WITH counts AS (
      SELECT "domain", COUNT(*)::bigint c
      FROM "Event" WHERE "uploadId" = ${uploadId} AND "domain" IS NOT NULL
      GROUP BY "domain"
    )
    SELECT e."domain" as domain, c.c as c,
           (SELECT id FROM "Event" 
             WHERE "uploadId"=${uploadId} AND "domain"=e."domain"
             ORDER BY "ts" ASC, "id" ASC LIMIT 1) as event_id
    FROM "Event" e
    JOIN counts c ON c."domain"=e."domain"
    WHERE e."uploadId"=${uploadId}
    GROUP BY e."domain", c.c
    ORDER BY c.c ASC
  `;

  const thr = Math.max(1, Math.floor(totals * 0.02)); // <=2% of events
  let created = 0;
  for (const r of rows) {
    const c = Number(r.c);
    if (c <= thr) {
      const conf = Math.min(1, 0.6 + (thr - c + 1) * 0.1);
      await prisma.anomaly.create({
        data: {
          uploadId,
          eventId: r.event_id ?? null,
          detector: "D2_rare_domain",
          reasonText: `Rare domain ${r.domain} (count=${c} of ${totals})`,
          confidence: Number(conf.toFixed(2)),
        }
      });
      created++;
    }
  }
  return created;
}

/* -------------------- D3 -------------------- */
async function d3_errorRatio(uploadId: string) {
  const rows = await prisma.$queryRaw<{ actor: string; total: bigint; errors: bigint; event_id: number|null }[]>`
    WITH per_actor AS (
      SELECT COALESCE("userName","srcIp") as actor,
             COUNT(*)::bigint as total,
             SUM(CASE WHEN "status" >= 400 THEN 1 ELSE 0 END)::bigint as errors
      FROM "Event"
      WHERE "uploadId"=${uploadId}
      GROUP BY COALESCE("userName","srcIp")
    )
    SELECT actor, total, errors,
      (SELECT id FROM "Event"
       WHERE "uploadId"=${uploadId} AND (COALESCE("userName","srcIp") = per_actor.actor)
       ORDER BY "ts" ASC, "id" ASC LIMIT 1) as event_id
    FROM per_actor
    WHERE actor IS NOT NULL
    ORDER BY errors::float/NULLIF(total::float,0) DESC
  `;
  let created = 0;
  for (const r of rows) {
    const total = Number(r.total);
    const errors = Number(r.errors);
    if (total >= 5) {
      const ratio = total ? errors / total : 0;
      if (ratio >= 0.5) {
        await prisma.anomaly.create({
          data: {
            uploadId,
            eventId: r.event_id ?? null,
            detector: "D3_error_ratio",
            reasonText: `High error ratio for actor=${r.actor} (${errors}/${total}=${(ratio*100).toFixed(0)}%)`,
            confidence: Number(Math.min(1, 0.5 + ratio).toFixed(2)),
          }
        });
        created++;
      }
    }
  }
  return created;
}

/* -------------------- D4 -------------------- */
async function d4_egressOutlier(uploadId: string) {
  // get percentiles and max (returned as text from SQL)
  const agg = await prisma.$queryRaw<{ p95: string|null; p99: string|null; max: string|null }[]>`
    SELECT
      percentile_cont(0.95) within group (order by "bytesOut")::text as p95,
      percentile_cont(0.99) within group (order by "bytesOut")::text as p99,
      MAX("bytesOut")::text as max
    FROM "Event"
    WHERE "uploadId"=${uploadId} AND "bytesOut" IS NOT NULL
  `;
  const { p95, p99 } = agg[0] || {};
  if (!p95 || !p99) return 0;

  // Compute numeric threshold, then convert to BigInt for comparison
  const p95n = Number(p95);
  const p99n = Number(p99);
  const thrNum = Math.max(p99n, p95n * 5);           // conservative numeric threshold
  const thrBig = BigInt(Math.ceil(thrNum));          // BigInt threshold for Prisma filter

  const outliers = await prisma.event.findMany({
    where: { uploadId, bytesOut: { gt: thrBig } },   // BigInt vs BigInt
    orderBy: { bytesOut: "desc" },
    select: { id: true, bytesOut: true, userName: true, srcIp: true, domain: true, url: true }
  });

  let created = 0;
  for (const e of outliers) {
    const bytesOutNum = Number(e.bytesOut ?? 0n);    // for logging/conf only
    const conf = Math.min(1, 0.6 + Math.log10(Math.max(1, bytesOutNum) / Math.max(1, thrNum)));
    await prisma.anomaly.create({
      data: {
        uploadId,
        eventId: e.id,
        detector: "D4_egress_outlier",
        reasonText: `Large bytesOut ~ ${e.bytesOut?.toString()} to ${e.domain || e.url || "unknown"}`,
        confidence: Number(Math.max(0.6, conf).toFixed(2)),
      }
    });
    created++;
  }
  return created;
}

/* -------------------- D5 -------------------- */
async function d5_impossibleTravel(uploadId: string) {
  // Simple heuristic: same user, different country within 2 hours.
  const rows = await prisma.$queryRaw<{ id: number; ts: Date; user: string; country: string|null }[]>`
    SELECT id, "ts", "userName" as user, "country"
    FROM "Event"
    WHERE "uploadId"=${uploadId} AND "userName" IS NOT NULL AND "ts" IS NOT NULL AND "country" IS NOT NULL
    ORDER BY "userName" ASC, "ts" ASC, id ASC
  `;

  let created = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i-1], b = rows[i];
    if (a.user === b.user && a.country !== b.country) {
      const dt = (new Date(b.ts).getTime() - new Date(a.ts).getTime()) / (1000*60*60); // hours
      if (dt <= 2) {
        await prisma.anomaly.create({
          data: {
            uploadId,
            eventId: b.id,
            detector: "D5_impossible_travel",
            reasonText: `User ${b.user} moved ${a.country}→${b.country} in ~${dt.toFixed(2)}h`,
            confidence: 0.8
          }
        });
        created++;
      }
    }
  }
  return created;
}
