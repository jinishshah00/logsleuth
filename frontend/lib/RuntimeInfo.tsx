"use client";

import React, { useEffect, useState } from "react";
import { API_BASE } from "./api";

export default function RuntimeInfo() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      console.log("Runtime API_BASE:", API_BASE);
    } catch (e) {
      console.log("Runtime API base read error", e);
    }
  }, []);

  if (!mounted) return null;

  return (
    <div>
      {/* API_BASE: <code style={{ color: "#9cf" }}>{API_BASE}</code> */}
    </div>
  );
}
