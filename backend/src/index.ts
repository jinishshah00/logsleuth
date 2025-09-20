import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
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
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.set("json replacer", (_key: string, value: unknown) =>
  typeof value === "bigint" ? Number(value) : value
);


app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: (process.env.FRONTEND_ORIGIN?.split(",") ?? ["http://localhost:3000"]),
    credentials: true,
  })
);

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
