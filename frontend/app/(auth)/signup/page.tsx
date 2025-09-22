"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, extractErrorMessage } from "@/lib/api";

export default function SignupPage() {
  const r = useRouter();
  const [id, setId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await apiPost("/auth/signup", { id, email, password });
      r.push("/login");
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      setErr(msg || "failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 border rounded-2xl p-6">
        <h1 className="text-xl font-semibold text-center">Create profile</h1>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="User Name (ID)"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => r.push('/login')}
            className="flex-1 rounded-xl px-4 py-2 border"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-xl px-4 py-2 border"
          >
            {loading ? "Creating..." : "Create profile"}
          </button>
        </div>
      </form>
    </main>
  );
}
