import { prisma } from "../db";
import { getSummary } from "./analytics";
import { runAnomalyDetection } from "./anomaly";

// If on Node 18+, globalThis.fetch exists. Otherwise, uncomment next line after installing 'undici'.
// import { fetch } from "undici";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

async function callOpenAI(system: string, user: string): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("NO_KEY");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}

export async function aiSummarizeUpload(uploadId: string) {
  // Derive the facts we’ll summarize
  const s = await getSummary(uploadId);

  const facts = {
    total: s.total,
    topSrcIp: s.topSrcIp,
    topDomains: s.topDomains,
    statusCounts: s.statusCounts,
    methodCounts: s.methodCounts,
    bytes: s.bytes,
    series: s.series?.slice(-24), // last ~2h
  };

  // Replacer to handle bigint -> number so JSON.stringify won't crash
  const bigintReplacer = (_key: string, value: unknown) =>
    typeof value === "bigint" ? Number(value) : value;

  const system = `You are a SOC analyst. Write concise, actionable summaries from log aggregates.
Avoid fluffy language. Output 4-8 bullet points and a 2-3 sentence conclusion.`;

  const user = `Summarize this upload in SOC style.
JSON:
${JSON.stringify(facts, bigintReplacer)}`;

  try {
    const text = await callOpenAI(system, user);
    return { used: "openai" as const, text };
  } catch {
    // fallback (no key or API error)
    const bullets: string[] = [];
    bullets.push(`Total events: ${s.total}`);
    if (s.topSrcIp?.length)
      bullets.push(
        `Most active source IPs: ${s.topSrcIp
          .slice(0, 3)
          .map((x) => `${x.src_ip} (${Number(x.c)})`)
          .join(", ")}`
      );
    if (s.topDomains?.length)
      bullets.push(
        `Top domains: ${s.topDomains
          .slice(0, 5)
          .map((x) => `${x.domain} (${Number(x.c)})`)
          .join(", ")}`
      );
    if (s.statusCounts?.length)
      bullets.push(
        `Status mix: ${s.statusCounts
          .map((x) => `${x.status}:${Number(x.c)}`)
          .join(", ")}`
      );
    if (s.bytes?.bytes_out_sum)
      bullets.push(`Total egress (bytesOut): ${s.bytes.bytes_out_sum}`);

    // Simple trend summary based on recent buckets
    let trend = "No trend data.";
    if (s.series && s.series.length) {
      const nums = s.series.map((b) => Number((b as any).c ?? 0));
      const sum = nums.reduce((a, b) => a + b, 0);
      const avg = Math.round(sum / Math.max(1, nums.length));
      const last = nums[nums.length - 1];
      if (last > avg * 2) trend = `Recent surge: ${last} events (avg ${avg}).`;
      else if (last < Math.max(1, Math.floor(avg / 2))) trend = `Recent drop: ${last} events (avg ${avg}).`;
      else trend = `Events stable around ${avg} per bucket.`;
    }

    bullets.push(`Trend: ${trend}`);

    const text = bullets.join("\n");
    return { used: "fallback" as const, text };
  }
}


export async function aiExplainAnomalies(uploadId: string) {
  // Ensure anomalies exist (if not, run detection quickly)
  const existing = await prisma.anomaly.count({ where: { uploadId } });
  if (existing === 0) await runAnomalyDetection(uploadId);

  const anomalies = await prisma.anomaly.findMany({
    where: { uploadId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, detector: true, reasonText: true, confidence: true,
      event: { select: { ts: true, userName: true, srcIp: true, domain: true, url: true, method: true, status: true, bytesOut: true } }
    }
  });

  const brief = anomalies.map(a => ({
    id: a.id, detector: a.detector, reasonText: a.reasonText, confidence: a.confidence,
    event: a.event ? {
      ts: a.event.ts, userName: a.event.userName, srcIp: a.event.srcIp,
      domain: a.event.domain, url: a.event.url, method: a.event.method,
      status: a.event.status, bytesOut: a.event.bytesOut?.toString() ?? null,
    } : null
  }));

  const system = `You are a SOC analyst. Explain anomalies succinctly and suggest next steps.
Return 1-2 sentences per anomaly.`;
  const user = `Explain these anomalies for triage:\n${JSON.stringify(brief)}`;

  try {
    const text = await callOpenAI(system, user);
    return { used: "openai" as const, text, items: brief };
  } catch {
    // Fallback: rule-based short explanations
    const lines = brief.map(b => {
      let why = "";
      switch (b.detector) {
        case "D2_rare_domain":
          why = "Domain seen rarely in this upload. Verify if sanctioned; check reputation and related sessions.";
          break;
        case "D4_egress_outlier":
          why = "Unusually large data egress. Validate business need and destination ownership.";
          break;
        case "D1_rate_spike":
          why = "Abrupt spike in request rate by actor; could indicate scripted activity or compromise.";
          break;
        case "D3_error_ratio":
          why = "High error ratio; investigate service abuse or misconfiguration.";
          break;
        case "D5_impossible_travel":
          why = "Geolocation changed too quickly; review VPN usage or account compromise.";
          break;
        default:
          why = "Behavior differs from baseline; review context.";
      }
      return `• ${b.detector} (${Math.round(b.confidence*100)}%): ${why}`;
    }).join("\n");
    return { used: "fallback" as const, text: lines, items: brief };
  }
}
