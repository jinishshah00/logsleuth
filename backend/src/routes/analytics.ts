import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { getSummary, listEvents, getTimeline } from "../services/analytics";

const router = Router();

// Ensure the upload belongs to the user (simple owner check)
async function assertUploadOwned(uid: string, uploadId: string) {
  const u = await prisma.upload.findFirst({ where: { id: uploadId, uploadedBy: uid } });
  return !!u;
}

// GET /uploads/:id/summary
router.get("/uploads/:id/summary", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const id = req.params.id;
  if (!(await assertUploadOwned(uid, id))) return res.status(404).json({ ok: false });
  // parse bucketMinutes and validate
  const allowed = new Set([1,5,10,15,30,60]);
  const bm = Number(req.query.bucketMinutes || 5) || 5;
  const bucketMinutes = allowed.has(bm) ? bm : 5;

  const data = await getSummary(id, bucketMinutes);
  res.json({ ok: true, ...data });
});

// GET /uploads/:id/events?srcIp=&domain=&status=200,404&method=GET,POST&page=1&pageSize=25&timeFrom=&timeTo=&search=
router.get("/uploads/:id/events", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const id = req.params.id;
  if (!(await assertUploadOwned(uid, id))) return res.status(404).json({ ok: false });

  const data = await listEvents(id, req.query as any);
  res.json({ ok: true, ...data });
});

// GET /uploads/:id/timeline?limit=200
router.get("/uploads/:id/timeline", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const id = req.params.id;
  if (!(await assertUploadOwned(uid, id))) return res.status(404).json({ ok: false });

  const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
  const data = await getTimeline(id, limit);
  res.json({ ok: true, ...data });
});



export default router;
