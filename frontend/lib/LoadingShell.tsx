"use client";

import React, { useEffect } from "react";
import { LoadingProvider, LoadingBar, useLoading } from "./loading";

// expose global hooks for api helpers to call
function ExposeLoader() {
  const { start, stop } = useLoading();
  useEffect(() => {
    const g = globalThis as unknown as { __LS_loading_start?: () => void; __LS_loading_stop?: () => void };
    g.__LS_loading_start = start;
    g.__LS_loading_stop = stop;
    return () => {
      try { delete g.__LS_loading_start; } catch {}
      try { delete g.__LS_loading_stop; } catch {}
    };
  }, [start, stop]);
  return null;
}

export default function LoadingShell({ children }: { children: React.ReactNode }) {
  return (
    <LoadingProvider>
      <LoadingBar />
      <ExposeLoader />
      {children}
    </LoadingProvider>
  );
}
