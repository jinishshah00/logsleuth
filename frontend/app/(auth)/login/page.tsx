"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { apiGet } from "@/lib/api";

export default function LoginPage() {
  const r = useRouter();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin123!");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // if already logged in, redirect to uploads
    apiGet<{ ok: true; user: any }>("/auth/me")
      .then((res) => { if (!cancelled) r.replace("/uploads"); })
      .catch(() => {})
    return () => { cancelled = true; };
  }, [r]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await apiPost("/auth/login", { email, password });
      r.push("/uploads");
    } catch (e) {
      setErr("Invalid credentials");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 border rounded-2xl p-6">
        <h1 className="text-xl font-semibold text-center">Log in</h1>
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
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl px-4 py-2 border"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <div className="text-center">
          <a href="/signup" className="text-sm underline mt-2 inline-block">Create profile</a>
        </div>
      </form>
    </main>
  );
}
