"use client";

import React, { createContext, useContext, useState, useMemo } from "react";

type LoadingContext = {
  active: number;
  start: () => void;
  stop: () => void;
};

const Ctx = createContext<LoadingContext | null>(null);

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(0);
  const start = () => setActive(a => a + 1);
  const stop = () => setActive(a => Math.max(0, a - 1));
  const val = useMemo(() => ({ active, start, stop }), [active]);
  return <Ctx.Provider value={val}>{children}</Ctx.Provider>;
}

export function useLoading() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLoading must be used within LoadingProvider");
  return ctx;
}

export function LoadingBar() {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const visible = ctx.active > 0;
  return (
    <div className={`fixed left-0 top-0 right-0 h-1 z-50 transition-opacity ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="h-1 bg-gradient-to-r from-red-500 animate-loading-sweep" style={{ width: visible ? '100%' : '0%' }} />
    </div>
  );
}

// small CSS animation helper will be added to globals.css

export default LoadingBar;
