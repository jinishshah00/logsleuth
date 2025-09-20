import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type AuthPayload = { uid: string; role: string };

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req as any).cookies?.token as string | undefined;
  if (!token) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
    (req as any).auth = payload;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
}
