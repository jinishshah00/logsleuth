import dotenv from "dotenv";
dotenv.config();

// Startup environment validation (non-fatal): log presence of critical env vars without leaking secrets
function checkRequiredEnv() {
  const required = ["DATABASE_URL", "JWT_SECRET"];
  for (const v of required) {
    if (!process.env[v]) {
      console.warn(`[env] warning: required env var ${v} is not set`);
    }
  }

  // OPENAI_API_KEY is optional, but if missing we warn so AI features are clearly disabled
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[env] warning: OPENAI_API_KEY not set — AI features will be disabled");
  } else {
    console.log("[env] info: OPENAI_API_KEY is present");
  }
}

checkRequiredEnv();

import express from "express";
import cors from "cors";
import type { CorsOptions } from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { PrismaClient } from "@prisma/client";
import authRoutes from "./routes/auth";
import uploadsRoutes from "./routes/uploads";
import analyticsRoutes from "./routes/analytics";
import anomalyRoutes from "./routes/anomalies";
import aiRoutes from "./routes/ai";
import { requireAuth } from "./middleware/auth";

const prisma = new PrismaClient();
const app = express();
// Cloud Run (and other proxies) terminate TLS and forward client IPs in X-Forwarded-* headers.
// Enable 'trust proxy' so express and middleware (express-rate-limit) correctly honor those headers
// and don't throw validation errors when X-Forwarded-For is present.
app.set("trust proxy", true);
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.set("json replacer", (_key: string, value: unknown) =>
  typeof value === "bigint" ? Number(value) : value
);


app.use(helmet());
app.use(express.json());
app.use(cookieParser());
// CORS configuration
// - Accept comma-separated FRONTEND_ORIGIN values from env (exact match)
// - Always allow common local dev origins
// - Optionally allow any *.onrender.com origin (default true) to simplify demo deployments
const rawOrigins = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const allowedOrigins = new Set(
  rawOrigins
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const allowOnrenderWildcard = (process.env.ALLOW_ONRENDER_ORIGINS ?? "true").toLowerCase() === "true";

function isOriginAllowed(incomingOrigin?: string): boolean {
  if (!incomingOrigin) return true; // non-browser / curl
  // exact allowlist match
  if (allowedOrigins.has(incomingOrigin)) return true;
  // common local dev
  if (incomingOrigin === "http://localhost:3000" || incomingOrigin === "http://localhost:5173") return true;
  // allow any Render-hosted frontend by default to reduce friction during demo
  if (allowOnrenderWildcard && /\.onrender\.com$/i.test(new URL(incomingOrigin).host)) return true;
  return false;
}

const corsOptions: CorsOptions = {
  origin: (incomingOrigin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (isOriginAllowed(incomingOrigin)) return callback(null, true);
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[cors] blocked origin: ${incomingOrigin ?? "<none>"}. Allowed: ${Array.from(allowedOrigins).join(", ")}, onrenderWildcard=${allowOnrenderWildcard}`);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"] as string[],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"] as string[],
};

app.use(cors(corsOptions));
// Ensure preflight requests are answered with the same CORS policy
// Instead of registering an OPTIONS route (which can trigger path-to-regexp
// parsing errors for patterns like '*' in some router versions), handle
// preflight requests with a small middleware that invokes the CORS handler
// and returns 204. This avoids adding a route pattern that the router parser
// may reject during startup.
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    // Evaluate CORS for this preflight; respond 204 if allowed, 403 otherwise
    return cors(corsOptions)(req as any, res as any, (err: any) => {
      if (err) return res.sendStatus(403);
      return res.sendStatus(204);
    });
  }
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "backend", env: process.env.NODE_ENV ?? "dev" });
});

app.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// Auth & feature routes
app.use("/auth", authRoutes);
app.use("/uploads", uploadsRoutes);
app.use("/api", analyticsRoutes);
app.use("/api", anomalyRoutes);
app.use("/api", aiRoutes);

// Example protected route
app.get("/secret", requireAuth, (_req, res) => {
  res.json({ ok: true, msg: "top secret" });
});

app.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
});
