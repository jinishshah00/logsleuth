"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, BarChart, Bar, Brush
} from "recharts";

function CustomTimeTick(props: any) {
  const { x, y, payload } = props;
  const d = new Date(payload.value);
  const dateStr = d.toLocaleDateString();
  const timeStr = d.toLocaleTimeString();
  return (
    <text x={x} y={y} dy={10} textAnchor="middle" className="fill-gray-700" fontSize={10}>
      <tspan x={x} dy={-4}>{dateStr}</tspan>
      <tspan x={x} dy={12}>{timeStr}</tspan>
    </text>
  );
}

type Summary = {
  ok: true; total: number;
  topSrcIp: { src_ip: string; c: number }[];
  topDomains: { domain: string; c: number }[];
  statusCounts: { status: number; c: number }[];
  methodCounts: { method: string; c: number }[];
  bytes: {
    bytes_out_sum: string|null; bytes_in_sum: string|null;
    bytes_out_p50: string|null; bytes_out_p90: string|null; bytes_out_p99: string|null;
  };
  series: { bucket: string; c: number }[];
};

type EventsResp = {
  ok: true; total: number; page: number; pageSize: number;
  items: {
    id: number; ts: string | null; srcIp: string | null; userName: string | null;
    url: string | null; domain: string | null; method: string | null; status: number | null;
    category: string | null; action: string | null; bytesOut: number | null; bytesIn: number | null;
    userAgent: string | null; urlPath: string | null;
  }[];
};

type TimelineResp = {
  ok: true; items: {
    id: number; ts: string | null; srcIp: string | null; userName: string | null;
    domain: string | null; url: string | null; method: string | null; status: number | null;
    category: string | null; action: string | null;
  }[]; limit: number;
};

type AnomalyResp = {
  ok: true;
  items: {
    id: string;
    detector: string;
    reasonText: string;
    confidence: number;
    createdAt: string;
    event?: {
      id: number; ts: string|null; srcIp: string|null; userName: string|null;
      domain: string|null; url: string|null; method: string|null; status: number|null; bytesOut: number|null
    } | null;
  }[];
};

export default function UploadDetailPage() {
  const params = useParams<{ id: string }>();
  const uploadId = params.id;
  const router = useRouter();
  const [tab, setTab] = useState<"summary"|"events"|"timeline"|"anomalies"|"ai">("summary");

  const [uploadName, setUploadName] = useState<string | null>(null);
  const [bucketMinutes, setBucketMinutes] = useState<number>(5);

  // summary
  const [summary, setSummary] = useState<Summary | null>(null);
  // events
  const [ev, setEv] = useState<EventsResp | null>(null);
  const [page, setPage] = useState(1);
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  // timeline (windowed)
  const [tlItems, setTlItems] = useState<TimelineResp["items"] | null>(null);
  const [tlLimit, setTlLimit] = useState<number>(100);
  const [tlNextCursorAfter, setTlNextCursorAfter] = useState<string | null>(null);
  const [tlNextCursorBefore, setTlNextCursorBefore] = useState<string | null>(null);
  const [tlWindow, setTlWindow] = useState<{ startTs?: string; endTs?: string } | null>(null);
  const [tlLoading, setTlLoading] = useState(false);
  // timeline filters / cursors
  const [tlActor, setTlActor] = useState<string>("");
  const [tlDomain, setTlDomain] = useState<string>("");
  const [tlStartTs, setTlStartTs] = useState<string | null>(null);
  const [tlEndTs, setTlEndTs] = useState<string | null>(null);
  const [tlCursorAfter, setTlCursorAfter] = useState<string | null>(null);
  const [tlCursorBefore, setTlCursorBefore] = useState<string | null>(null);
  // anomalies
  const [anoms, setAnoms] = useState<AnomalyResp["items"] | null>(null);
  // AI explanations (TODO)
  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiExpl, setAiExpl] = useState<string>("");


  useEffect(() => {
    apiGet<Summary>(`/api/uploads/${uploadId}/summary?bucketMinutes=${bucketMinutes}`).then(setSummary).catch(() => {});
  }, [uploadId, bucketMinutes]);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: true; upload: { id: string; filename: string } }>(`/uploads/${uploadId}`)
      .then((res) => { if (!cancelled) setUploadName(res.upload.filename); })
      .catch(() => {})
    return () => { cancelled = true; };
  }, [uploadId]);

  useEffect(() => {
    apiGet<EventsResp>(
      `/api/uploads/${uploadId}/events?page=${page}&pageSize=25&method=${encodeURIComponent(method)}&status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}`
    ).then(setEv).catch(() => {});
  }, [uploadId, page, method, status, search]);

  // helper to fetch timeline with provided params (does not rely on state being set first)
  async function fetchTimelineWithParams(params: {
    limit?: number;
    cursorAfter?: string | null;
    cursorBefore?: string | null;
    startTs?: string | null;
    endTs?: string | null;
    actor?: string;
    domain?: string;
  }) {
    setTlLoading(true);
    try {
      const qs = new URLSearchParams();
      if (params.limit) qs.set("limit", String(params.limit));
      if (params.cursorAfter) qs.set("cursorAfter", params.cursorAfter);
      if (params.cursorBefore) qs.set("cursorBefore", params.cursorBefore);
      if (params.startTs) qs.set("startTs", params.startTs);
      if (params.endTs) qs.set("endTs", params.endTs);
      if (params.actor) qs.set("actor", params.actor);
      if (params.domain) qs.set("domain", params.domain);

      const res = await apiGet<any>(`/api/uploads/${uploadId}/timeline?${qs.toString()}`);
      if (!res) {
        setTlItems(null);
        setTlNextCursorAfter(null);
        setTlNextCursorBefore(null);
        setTlWindow(null);
        return;
      }
      setTlItems(res.items ?? []);
      setTlLimit(res.limit ?? params.limit ?? 100);
      setTlNextCursorAfter(res.nextCursorAfter ?? null);
      setTlNextCursorBefore(res.nextCursorBefore ?? null);
      setTlWindow(res.window ?? null);
    } catch (err) {
      setTlItems(null);
      setTlNextCursorAfter(null);
      setTlNextCursorBefore(null);
      setTlWindow(null);
    } finally {
      setTlLoading(false);
    }
  }

  // initial load: most recent events when opening the timeline tab or on upload change
  useEffect(() => {
    if (tab !== "timeline") return;
    // reset filters/cursors and fetch most recent
    setTlCursorAfter(null); setTlCursorBefore(null);
    setTlStartTs(null); setTlEndTs(null); setTlActor(""); setTlDomain("");
    fetchTimelineWithParams({ limit: tlLimit });
  }, [tab, uploadId]);

  async function refreshAnoms() {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
    const r = await fetch(`${base}/api/uploads/${uploadId}/anomalies`, { credentials: "include" });
    if (!r.ok) throw new Error("anom fetch");
    const j: AnomalyResp = await r.json();
    setAnoms(j.items);
  }

  useEffect(() => {
    if (tab === "anomalies") {
      refreshAnoms().catch(() => {});
    }
  }, [tab, uploadId]);

  const series = useMemo(
    () => (summary?.series || []).map(d => ({ t: d.bucket, c: Number(d.c) })),
    [summary]
  );

  async function genAiSummary() {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
    const r = await fetch(`${base}/api/uploads/${uploadId}/ai/summary`, { method: "POST", credentials: "include" });
    if (!r.ok) { alert("AI summary failed"); return; }
    const j = await r.json();
    setAiSummary(j.text || "");
  }

  async function genAiExpl() {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
    const r = await fetch(`${base}/api/uploads/${uploadId}/ai/explanations`, { method: "POST", credentials: "include" });
    if (!r.ok) { alert("AI explanations failed"); return; }
    const j = await r.json();
    setAiExpl(j.text || "");
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <a href="/uploads" aria-label="Back to uploads" className="inline-flex items-center justify-center w-10 h-10 rounded-full border hover:bg-gray-100 flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <h1 className="text-2xl font-semibold truncate min-w-0">{uploadName ?? `Upload ${uploadId}`}</h1>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Upload ID</div>
          <div className="text-2xl font-semibold font-mono">{uploadId}</div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setTab("summary")} className={`border rounded-xl px-3 py-1 ${tab==="summary" ? "bg-gray-100" : ""}`}>Summary</button>
        <button onClick={() => setTab("events")} className={`border rounded-xl px-3 py-1 ${tab==="events" ? "bg-gray-100" : ""}`}>Events</button>
        <button onClick={() => setTab("timeline")} className={`border rounded-xl px-3 py-1 ${tab==="timeline" ? "bg-gray-100" : ""}`}>Timeline</button>
        <button onClick={() => setTab("anomalies")} className={`border rounded-xl px-3 py-1 ${tab==="anomalies" ? "bg-gray-100" : ""}`}>Anomalies</button>
        <button onClick={() => setTab("ai")} className={`border rounded-xl px-3 py-1 ${tab==="ai" ? "bg-gray-100" : ""}`}>AI</button>
      </div>

      {tab === "summary" && (
        <section className="space-y-6">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="border rounded-2xl p-4">
              <div className="text-sm text-gray-500">Total events</div>
              <div className="text-2xl font-semibold">{summary?.total ?? "-"}</div>
            </div>
            <div className="border rounded-2xl p-4">
              <div className="text-sm text-gray-500">Bytes out (sum)</div>
              <div className="text-xl">{summary?.bytes.bytes_out_sum ?? "-"}</div>
            </div>
            <div className="border rounded-2xl p-4">
              <div className="text-sm text-gray-500">Bytes out p99</div>
              <div className="text-xl">{summary?.bytes.bytes_out_p99 ?? "-"}</div>
            </div>
          </div>

          <div className="relative border rounded-2xl p-6 overflow-hidden">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center">
                <div className="font-medium">Events over time</div>
                <div className="text-xs text-gray-500 ml-2">({bucketMinutes}m buckets)</div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm">Bucket (minutes)</label>
                <select value={bucketMinutes} onChange={(e)=>setBucketMinutes(Number(e.target.value))} className="border rounded px-2 py-1">
                  {[1,5,10,15,30,60].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={series} margin={{ top: 12, right: 24, bottom: 80, left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={<CustomTimeTick />} interval="preserveStartEnd" tickMargin={10} minTickGap={20} height={56} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Brush dataKey="t" height={16} travellerWidth={8} stroke="#8B0000" onChange={() => {}} />
                <Line type="monotone" dataKey="c" stroke="#8B0000" strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} animationDuration={0} />
              </LineChart>
            </ResponsiveContainer>
            <div className="absolute left-4 bottom-4 text-xs text-gray-500">Zoom &amp; pan: drag the handles or the shaded area to focus on a time range.</div>
            {summary?.series && summary.series.length > 2000 && (
              <div className="absolute right-4 bottom-4 text-sm text-yellow-600">Data is dense; increase bucket size to reduce noise.</div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-2xl p-4 h-72">
              <div className="mb-2 font-medium">Top source IPs</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(summary?.topSrcIp || []).map(x => ({ name: x.src_ip, c: Number(x.c) }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="c" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="border rounded-2xl p-4 h-72">
              <div className="mb-2 font-medium">Top domains</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(summary?.topDomains || []).map(x => ({ name: x.domain, c: Number(x.c) }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="c" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {tab === "events" && (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input value={method} onChange={e=>setMethod(e.target.value)} placeholder="method (e.g. GET,POST)" className="border rounded px-2 py-1"/>
            <input value={status} onChange={e=>setStatus(e.target.value)} placeholder="status (e.g. 200,404)" className="border rounded px-2 py-1"/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="search (url/domain/UA)" className="border rounded px-2 py-1 flex-1"/>
            <button onClick={()=>setPage(1)} className="border rounded px-3 py-1">Apply</button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border rounded-2xl text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Time</th>
                  <th className="p-2 text-left">Src IP</th>
                  <th className="p-2 text-left">User</th>
                  <th className="p-2 text-left">Method</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-left">Domain</th>
                  <th className="p-2 text-left">Path</th>
                </tr>
              </thead>
              <tbody>
                {ev?.items.map(it => (
                  <tr key={it.id} className="border-b">
                    <td className="p-2">{it.ts ? new Date(it.ts).toLocaleTimeString() : "-"}</td>
                    <td className="p-2">{it.srcIp ?? "-"}</td>
                    <td className="p-2">{it.userName ?? "-"}</td>
                    <td className="p-2">{it.method ?? "-"}</td>
                    <td className="p-2">{it.status ?? "-"}</td>
                    <td className="p-2">{it.domain ?? "-"}</td>
                    <td className="p-2">{it.urlPath ?? it.url ?? "-"}</td>
                  </tr>
                ))}
                {!ev?.items?.length && <tr><td className="p-3 text-gray-500" colSpan={7}>No events</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <button disabled={!ev || ev.page <= 1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="border rounded px-3 py-1">Prev</button>
            <div>Page {ev?.page ?? 1}</div>
            <button disabled={!ev || (ev.page*ev.pageSize)>= (ev.total||0)} onClick={()=>setPage(p=>p+1)} className="border rounded px-3 py-1">Next</button>
            <div className="text-gray-500">{ev?.total ?? 0} total</div>
          </div>
        </section>
      )}

      {tab === "timeline" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input value={tlActor} onChange={e=>setTlActor(e.target.value)} placeholder="Actor (user or IP)" className="border rounded px-2 py-1" />
            <input value={tlDomain} onChange={e=>setTlDomain(e.target.value)} placeholder="Domain" className="border rounded px-2 py-1" />
            <input value={tlStartTs ?? ""} onChange={e=>setTlStartTs(e.target.value || null)} placeholder="startTs (ISO)" className="border rounded px-2 py-1" />
            <input value={tlEndTs ?? ""} onChange={e=>setTlEndTs(e.target.value || null)} placeholder="endTs (ISO)" className="border rounded px-2 py-1" />
            <select value={tlLimit} onChange={e=>setTlLimit(Number(e.target.value))} className="border rounded px-2 py-1">
              {[25,50,100,200].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <button className="border rounded px-3 py-1" onClick={()=>{
              setTlCursorAfter(null); setTlCursorBefore(null);
              fetchTimelineWithParams({ limit: tlLimit, startTs: tlStartTs, endTs: tlEndTs, actor: tlActor || undefined, domain: tlDomain || undefined });
            }}>Apply</button>
          </div>

          <div className="text-sm text-gray-600">{tlWindow ? `Window: ${tlWindow.startTs ?? "?"} → ${tlWindow.endTs ?? "?"} · Limit: ${tlLimit}` : `Most recent events · Limit: ${tlLimit}`}</div>

          <div className="overflow-x-auto">
            <table className="w-full border rounded-2xl text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Time</th>
                  <th className="p-2 text-left">Actor</th>
                  <th className="p-2 text-left">Domain / URL</th>
                  <th className="p-2 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {tlItems?.map(it => (
                  <tr key={it.id} className="border-b">
                    <td className="p-2">{it.ts ? new Date(it.ts).toLocaleString() : "-"}</td>
                    <td className="p-2">{it.userName || it.srcIp || "-"}</td>
                    <td className="p-2">{it.domain || it.url || "-"}</td>
                    <td className="p-2">{`${it.method ?? ""} ${it.status ?? ""} ${it.category ?? ""} ${it.action ?? ""}`.trim()}</td>
                  </tr>
                ))}
                {!tlItems?.length && <tr><td className="p-3 text-gray-500" colSpan={4}>No timeline items</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <button className="border rounded px-3 py-1" disabled={!tlNextCursorAfter || tlLoading} onClick={()=>{
              setTlCursorAfter(tlNextCursorAfter); setTlCursorBefore(null);
              fetchTimelineWithParams({ limit: tlLimit, cursorAfter: tlNextCursorAfter, startTs: tlStartTs, endTs: tlEndTs, actor: tlActor || undefined, domain: tlDomain || undefined });
            }}>Load newer</button>
            <button className="border rounded px-3 py-1" disabled={!tlNextCursorBefore || tlLoading} onClick={()=>{
              setTlCursorBefore(tlNextCursorBefore); setTlCursorAfter(null);
              fetchTimelineWithParams({ limit: tlLimit, cursorBefore: tlNextCursorBefore, startTs: tlStartTs, endTs: tlEndTs, actor: tlActor || undefined, domain: tlDomain || undefined });
            }}>Load older</button>
          </div>
        </section>
      )}

      {tab === "anomalies" && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              className="border rounded px-3 py-1"
              onClick={async ()=>{
                const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
                const r = await fetch(`${base}/api/uploads/${uploadId}/anomalies/detect`, { method: "POST", credentials: "include" });
                if (!r.ok) { alert("Detection failed"); return; }
                await refreshAnoms();
              }}
            >
              Run detection
            </button>
            <span className="text-gray-500 text-sm">Runs D1–D5 with simple, explainable rules.</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border rounded-2xl text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Detector</th>
                  <th className="p-2 text-left">Confidence</th>
                  <th className="p-2 text-left">Reason</th>
                  <th className="p-2 text-left">Event</th>
                </tr>
              </thead>
              <tbody>
                {anoms?.map(a => (
                  <tr key={a.id} className="border-b">
                    <td className="p-2 font-mono">{a.detector}</td>
                    <td className="p-2">{Math.round(a.confidence*100)}%</td>
                    <td className="p-2">{a.reasonText}</td>
                    <td className="p-2">
                      {a.event ? (
                        <>
                          #{a.event.id} — {a.event.ts ? new Date(a.event.ts).toLocaleTimeString() : "-"} — {a.event.userName || a.event.srcIp || "-"} → {a.event.domain || a.event.url || "-"} {a.event.method || ""} {a.event.status ?? ""}
                          {a.event.bytesOut ? ` (${a.event.bytesOut} bytes)` : ""}
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
                {!anoms?.length && <tr><td className="p-3 text-gray-500" colSpan={4}>No anomalies yet</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "ai" && (
        <section className="space-y-4">
            <div className="flex gap-2">
            <button onClick={genAiSummary} className="border rounded px-3 py-1">Generate AI Summary</button>
            <button onClick={genAiExpl} className="border rounded px-3 py-1">Explain Anomalies (AI)</button>
            <span className="text-gray-500 text-sm">Uses OpenAI when configured; otherwise a safe fallback.</span>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
            <div className="border rounded-2xl p-4 whitespace-pre-wrap">
                <div className="font-medium mb-2">AI Summary</div>
                {aiSummary || <div className="text-gray-500 text-sm">No summary yet.</div>}
            </div>
            <div className="border rounded-2xl p-4 whitespace-pre-wrap">
                <div className="font-medium mb-2">AI Explanations</div>
                {aiExpl || <div className="text-gray-500 text-sm">No explanations yet.</div>}
            </div>
            </div>
        </section>
      )}
    </main>
  );
}
