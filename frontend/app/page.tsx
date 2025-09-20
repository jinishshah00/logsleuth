"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";

export default function Home() {
  const r = useRouter();

  useEffect(() => {
    let cancelled = false;
    apiGet("/auth/me")
      .then(() => { if (!cancelled) r.replace("/uploads"); })
      .catch(() => { if (!cancelled) r.replace("/login"); });
    return () => { cancelled = true; };
  }, [r]);

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">LogSleuth</h1>
      <p>Redirecting…</p>
    </main>
  );
}
