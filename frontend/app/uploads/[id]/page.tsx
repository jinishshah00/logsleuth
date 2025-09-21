"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, BarChart, Bar, Brush
} from "recharts";

function CustomTimeTick(props: any) {
  const { x, y, payload } = props;
  const d = new Date(payload.value);
  // render ticks in UTC consistently so uploaded ISO timestamps with Z show correctly
  const dateStr = d.toISOString().split("T")[0];
  // drop milliseconds (e.g. 09:00:56.000 -> 09:00:56)
  const timeStr = d.toISOString().split("T")[1].split(".")[0];
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
    id: number; ts: string | null; date?: string | null; srcIp: string | null; userName: string | null;
    url: string | null; domain: string | null; method: string | null; status: number | null;
    category: string | null; action: string | null; bytesOut?: number | null; bytesIn?: number | null;
    userAgent: string | null; urlPath: string | null;
  }[];
};

type TimelineResp = {
  ok: true; items: {
    id: number; ts: string | null; date?: string | null; srcIp: string | null; userName: string | null;
    domain: string | null; url: string | null; method: string | null; status: number | null;
    category: string | null; action: string | null; bytesOut?: number | null;
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
  const [srcIp, setSrcIp] = useState("");
  // timeline (paginated like Events)
  const [tlItems, setTlItems] = useState<EventsResp["items"] | null>(null);
  const [tlPage, setTlPage] = useState<number>(1);
  const [tlTotal, setTlTotal] = useState<number | null>(null);
  const [tlLoading, setTlLoading] = useState(false);
  // timeline filters
  const [tlActor, setTlActor] = useState<string>("");
  const [tlEndTs, setTlEndTs] = useState<string | null>(null);
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

  // helper to fetch timeline as paginated events (25 per page)
  async function fetchTimelinePage(page: number) {
    setTlLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("pageSize", String(25));
      // timeline should use the same filters as events
      if (method) qs.set("method", method);
      if (status) qs.set("status", status);
      if (search) qs.set("search", search);
  if (tlActor) qs.set("search", tlActor);
  if (tlEndTs) qs.set("timeTo", tlEndTs);
  const res = await apiGet<EventsResp>(`/api/uploads/${uploadId}/events?${qs.toString()}`);
      if (!res) {
        setTlItems(null);
        setTlTotal(null);
        return;
      }
      setTlItems(res.items ?? []);
      setTlPage(res.page ?? page);
      setTlTotal(res.total ?? null);
    } catch (err) {
      setTlItems(null);
      setTlTotal(null);
    } finally {
      setTlLoading(false);
    }
  }

  // initial load: most recent events when opening the timeline tab or on upload change
  useEffect(() => {
    if (tab !== "timeline") return;
    // reset filters and fetch first page
  setTlPage(1);
  setTlEndTs(null); setTlActor("");
    fetchTimelinePage(1);
  }, [tab, uploadId]);

  async function refreshAnoms() {
    try {
      const j = await apiGet<AnomalyResp>(`/api/uploads/${uploadId}/anomalies`);
      setAnoms(j.items);
    } catch (err) {
      console.error("refreshAnoms", err);
      setAnoms(null);
      throw err;
    }
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
    try {
      const j = await apiPost<{ text?: string }>(`/api/uploads/${uploadId}/ai/summary`, {});
      setAiSummary(j.text || "");
    } catch (err) {
      alert("AI summary failed");
    }
  }

  async function genAiExpl() {
    try {
      const j = await apiPost<{ text?: string }>(`/api/uploads/${uploadId}/ai/explanations`, {});
      setAiExpl(j.text || "");
    } catch (err) {
      alert("AI explanations failed");
    }
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
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="search (url/domain/UA)" className="border rounded px-2 py-1"/>
            <div className="flex items-center gap-2">
              <button onClick={()=>setPage(1)} className="border rounded px-3 py-1">Apply</button>
              <button onClick={()=>{ setMethod(""); setStatus(""); setSearch(""); setPage(1); }} className="border rounded px-3 py-1">Reset</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border rounded-2xl text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-left">Time (UTC)</th>
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
                    <td className="p-2">{it.date ?? (it.ts ? new Date(it.ts).toISOString().split('T')[0] : "-")}</td>
                    <td className="p-2">{it.ts ? new Date(it.ts).toISOString().split('T')[1].split('.')[0] : "-"}</td>
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
          <div className="flex items-center gap-2 flex-nowrap overflow-x-auto">
            <input value={tlActor} onChange={e=>setTlActor(e.target.value)} placeholder="Actor (user or IP)" className="border rounded px-2 py-1" />
            {/* srcIp filter removed (redundant with Actor) */}
            {/* domain filter removed (duplicate on timeline tab) */}
            <input value={tlEndTs ?? ""} onChange={e=>setTlEndTs(e.target.value || null)} placeholder="Time (ISO)" className="border rounded px-2 py-1" />
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="search (url/domain/UA)" className="border rounded px-2 py-1" />
            <input value={status} onChange={e=>setStatus(e.target.value)} placeholder="status (e.g. 200,404)" className="border rounded px-2 py-1" />
            <select value={method} onChange={e=>setMethod(e.target.value)} className="border rounded px-3 py-1 h-8.5 leading-6">
              <option value="">Any method</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
            <div className="flex items-center gap-2">
              <button className="border rounded px-3 py-1" onClick={()=>{ setTlPage(1); fetchTimelinePage(1); }}>Apply</button>
              <button className="border rounded px-3 py-1" onClick={()=>{ setTlActor(""); setTlEndTs(null); setSearch(""); setStatus(""); setMethod(""); setTlPage(1); fetchTimelinePage(1); }}>Reset</button>
            </div>
          </div>


          <div className="overflow-x-auto">
            <table className="w-full border rounded-2xl text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-left">Time (UTC)</th>
                  <th className="p-2 text-left">Actor</th>
                  <th className="p-2 text-left">Domain / URL</th>
                  <th className="p-2 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {tlItems?.map(it => (
                  <tr key={it.id} className="border-b">
                    <td className="p-2">{it.date ?? (it.ts ? new Date(it.ts).toISOString().split('T')[0] : "-")}</td>
                    <td className="p-2">{it.ts ? new Date(it.ts).toISOString().split('T')[1].split('.')[0] : "-"}</td>
                    <td className="p-2">{it.userName || it.srcIp || "-"}</td>
                    <td className="p-2">{it.domain || it.url || "-"}</td>
                    <td className="p-2">{`${it.method ?? ""} ${it.status ?? ""} ${it.category ?? ""} ${it.action ?? ""}`.trim()}{it.bytesOut ? ` · ${it.bytesOut} bytes` : ""}</td>
                  </tr>
                ))}
                {!tlItems?.length && <tr><td className="p-3 text-gray-500" colSpan={4}>No timeline items</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <button disabled={!tlItems || tlPage <= 1} onClick={()=>setTlPage(p=>{ const np = Math.max(1, p-1); fetchTimelinePage(np); return np; })} className="border rounded px-3 py-1">Prev</button>
            <div>Page {tlPage}</div>
            <button disabled={!tlItems || (tlPage*25) >= (tlTotal||0)} onClick={()=>setTlPage(p=>{ const np = p+1; fetchTimelinePage(np); return np; })} className="border rounded px-3 py-1">Next</button>
            <div className="text-gray-500">{tlTotal ?? 0} total</div>
          </div>
        </section>
      )}

      {tab === "anomalies" && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              className={`border rounded px-3 py-1 ${anoms && anoms.length > 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={!!(anoms && anoms.length > 0)}
              onClick={async ()=>{
                try {
                  await apiPost(`/api/uploads/${uploadId}/anomalies/detect`, {});
                  await refreshAnoms();
                } catch (err) {
                  alert("Detection failed");
                }
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
                          #{a.event.id} — {a.event.ts ? new Date(a.event.ts).toISOString().split('T')[1].split('.')[0] : "-"} — {a.event.userName || a.event.srcIp || "-"} → {a.event.domain || a.event.url || "-"} {a.event.method || ""} {a.event.status ?? ""}
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
