import { Router } from "express";
import { prisma } from "../db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import rateLimit from "express-rate-limit";

const router = Router();

// ...existing code...

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // Use the request's ip (as resolved by Express) to identify clients for rate-limiting.
  // This avoids express-rate-limit validating forwarded headers or trust proxy
  // behavior which can throw at startup in some environments.
  keyGenerator: (req) => {
    return req.ip || (req as any).headers['x-forwarded-for'] || '';
  },
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const SignupSchema = z.object({
  id: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

router.post("/login", loginLimiter, async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid" });

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ ok: false, error: "invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, error: "invalid credentials" });

  const token = jwt.sign(
    { uid: user.id, role: user.role },
    process.env.JWT_SECRET as string,
    { expiresIn: "1d" }
  );

  // Cookie options: if frontend is served over HTTPS and not localhost, we must set
  // SameSite=None and Secure=true so the browser will send cookies cross-site.
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
  const isFrontendSecure = frontendOrigin.startsWith("https://") && !frontendOrigin.includes("localhost");
  const cookieOptions: any = {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    // default to lax for local development
    sameSite: "lax",
    secure: false,
  };
  if (isFrontendSecure) {
    cookieOptions.sameSite = "none";
    cookieOptions.secure = true;
  } else if (process.env.NODE_ENV === "production") {
    // In production, prefer secure cookies when possible
    cookieOptions.secure = true;
  }

  res.cookie("token", token, cookieOptions);

  return res.json({ ok: true });
});

router.post("/signup", async (req, res) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid" });

  const { id, email, password } = parsed.data;
  try {
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(400).json({ ok: false, error: "email exists" });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { id, email, passwordHash: hash, role: "user" } });
    return res.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server error" });
  }
});

router.post("/logout", (_req, res) => {
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
  const isFrontendSecure = frontendOrigin.startsWith("https://") && !frontendOrigin.includes("localhost");
  const clearOpts: any = { httpOnly: true, sameSite: "lax", secure: false };
  if (isFrontendSecure) {
    clearOpts.sameSite = "none";
    clearOpts.secure = true;
  } else if (process.env.NODE_ENV === "production") {
    clearOpts.secure = true;
  }
  res.clearCookie("token", clearOpts);
  res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  const token = (req as any).cookies?.token as string | undefined;
  if (!token) return res.status(401).json({ ok: false });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as { uid: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.uid },
      select: { id: true, email: true, role: true },
    });
    if (!user) return res.status(401).json({ ok: false });
    res.json({ ok: true, user });
  } catch {
    res.status(401).json({ ok: false });
  }
});

export default router;

