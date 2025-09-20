import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { aiSummarizeUpload, aiExplainAnomalies } from "../services/ai";

const router = Router();

async function assertOwned(uid: string, uploadId: string) {
  const u = await prisma.upload.findFirst({ where: { id: uploadId, uploadedBy: uid } });
  return !!u;
}

// POST /api/uploads/:id/ai/summary
router.post("/uploads/:id/ai/summary", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const id = req.params.id;
  if (!(await assertOwned(uid, id))) return res.status(404).json({ ok: false });

  const out = await aiSummarizeUpload(id);
  res.json({ ok: true, ...out });
});

// POST /api/uploads/:id/ai/explanations
router.post("/uploads/:id/ai/explanations", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const id = req.params.id;
  if (!(await assertOwned(uid, id))) return res.status(404).json({ ok: false });

  const out = await aiExplainAnomalies(id);
  res.json({ ok: true, ...out });
});

export default router;
