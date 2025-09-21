"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiPostForm, apiDelete } from "@/lib/api";

type Me = { ok: true; user: { id: string; email: string; role: string } };

type UploadRow = {
  id: string; filename: string; status: "RECEIVED" | "PARSING" | "PARSED" | "FAILED";
  uploadedAt: string; parsedRows: number | null; totalRows: number | null;
};

export default function UploadsPage() {
  const r = useRouter();
  const [me, setMe] = useState<Me["user"] | null>(null);
  const [loading, setLoading] = useState(true);

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);

  async function refresh() {
    const res = await apiGet<{ ok: true; uploads: UploadRow[] }>("/uploads");
    setRows(res.uploads);
  }

  useEffect(() => {
    let cancelled = false;
    apiGet<Me>("/auth/me")
      .then((res) => {
        if (!cancelled) {
          setMe(res.user);
          setLoading(false);
          // load uploads after auth
          refresh().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) {
          r.replace("/login");
        }
      });
    return () => { cancelled = true; };
  }, [r]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await apiPostForm(`/uploads`, form);
      await refresh();
      setFile(null);
      (document.getElementById("file-input") as HTMLInputElement).value = "";
    } catch (e: any) {
      setErr(e.message || "upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">LogSleuth Dashboard</h1>
          <p className="text-sm">Logged in as <b>{me?.email}</b> ({me?.role})</p>
        </div>
        <div>
          <button
            className="border rounded-xl px-4 py-2"
            onClick={async () => {
              await apiPost("/auth/logout", {});
              window.location.href = "/login";
            }}
          >
            Log out
          </button>
        </div>
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-3 border rounded-2xl p-4">
        <input
          id="file-input"
          type="file"
          accept=".log,.txt,.csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="border rounded px-3 py-2"
        />
        <button
          type="submit"
          disabled={!file || busy}
          className="border rounded-xl px-4 py-2"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
        {err && <span className="text-red-600 text-sm">{err}</span>}
      </form>

      <div className="overflow-x-auto">
        <table className="w-full border rounded-2xl">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 border-b">ID</th>
              <th className="text-left p-2 border-b">Filename</th>
              <th className="text-left p-2 border-b">Status</th>
              <th className="text-left p-2 border-b">Actions</th>
              <th className="text-left p-2 border-b">Uploaded</th>
              <th className="text-left p-2 border-b">Parsed/Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
                <tr key={r.id} className="border-b">
                <td className="p-2 font-mono text-sm">{r.id}</td>
                <td className="p-2">{r.filename}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">
                    <button
                        className={"mr-2 border rounded px-2 py-1 text-sm " + (r.status === 'PARSED' ? 'opacity-50 cursor-not-allowed' : '')}
                        disabled={r.status === 'PARSED'}
                        onClick={async () => {
                        // if already parsed, button is disabled by attribute; guard here just in case
                        if (r.status === 'PARSED') return;
                        try {
                          await apiPost(`/uploads/${r.id}/parse`, {});
                          await refresh();
                        } catch (e) {
                          alert("Parse failed. See backend logs.");
                        }
                        }}
                    >
                        Parse
                    </button>
                    <button
                        className="mr-2 border rounded px-2 py-1 text-sm text-red-700"
                        onClick={async () => {
                          if (!confirm(`Delete upload ${r.id} (${r.filename})? This cannot be undone.`)) return;
                          try {
                            await apiDelete(`/uploads/${r.id}`);
                            await refresh();
                          } catch (err: any) {
                            alert(`Delete failed: ${err?.message || String(err)}`);
                          }
                        }}
                    >
                        Delete
                    </button>
                    <a href={`/uploads/${r.id}`} className="underline text-sm">View</a>
                </td>
                <td className="p-2">{new Date(r.uploadedAt).toLocaleString()}</td>
                <td className="p-2">{r.parsedRows ?? "-"} / {r.totalRows ?? "-"}</td>
                </tr>
                ))}
                {rows.length === 0 && (
          <tr><td className="p-3 text-gray-500" colSpan={6}>No uploads yet</td></tr>
                )}
            </tbody>
        </table>
      </div>
    </main>
  );
}

