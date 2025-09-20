import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { runAnomalyDetection } from "../services/anomaly";

const router = Router();

// owner check
async function assertOwned(uid: string, uploadId: string) {
  const u = await prisma.upload.findFirst({ where: { id: uploadId, uploadedBy: uid } });
  return !!u;
}

// POST /api/uploads/:id/anomalies/detect
router.post("/uploads/:id/anomalies/detect", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const id = req.params.id;
  if (!(await assertOwned(uid, id))) return res.status(404).json({ ok: false });

  const counts = await runAnomalyDetection(id);
  res.json({ ok: true, counts });
});

// GET /api/uploads/:id/anomalies
router.get("/uploads/:id/anomalies", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const id = req.params.id;
  if (!(await assertOwned(uid, id))) return res.status(404).json({ ok: false });

  const items = await prisma.anomaly.findMany({
    where: { uploadId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, detector: true, reasonText: true, confidence: true, createdAt: true,
      event: {
        select: { id: true, ts: true, srcIp: true, userName: true, domain: true, url: true, method: true, status: true, bytesOut: true }
      }
    }
  });
  res.json({ ok: true, items });
});

export default router;
