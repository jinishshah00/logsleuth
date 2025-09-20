import { Router } from "express";
import { prisma } from "../db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import rateLimit from "express-rate-limit";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
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

  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // true in production behind HTTPS
    maxAge: 24 * 60 * 60 * 1000,
  });

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
  res.clearCookie("token", { httpOnly: true, sameSite: "lax", secure: false });
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

