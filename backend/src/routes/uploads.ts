import { Router } from "express";
import multer from "multer";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { saveBufferToLocal, deleteLocalFile } from "../storage/localStore";
import { parseUpload } from "../services/parseUpload";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

// Create Upload + save file locally
router.post("/", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "file missing" });

    // save to local disk for now
    const savedPath = await saveBufferToLocal(req.file.originalname, req.file.buffer);

    // create Upload row
    const u = await prisma.upload.create({
      data: {
        filename: req.file.originalname,
        gcsUri: savedPath, // temporarily store local path in this field; will swap to GCS later
        status: "RECEIVED",
        uploadedBy: (req as any).auth.uid,
      },
      select: { id: true, filename: true, status: true, uploadedAt: true }
    });

    return res.json({ ok: true, upload: u });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "upload_failed" });
  }
});

// List uploads for current user (simple)
router.get("/", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const uploads = await prisma.upload.findMany({
    where: { uploadedBy: uid },
    orderBy: { uploadedAt: "desc" },
    select: { id: true, filename: true, status: true, uploadedAt: true, parsedRows: true, totalRows: true }
  });
  res.json({ ok: true, uploads });
});

// Get one upload
router.get("/:id", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const id = req.params.id;
  const u = await prisma.upload.findFirst({
    where: { id, uploadedBy: uid },
    select: { id: true, filename: true, status: true, uploadedAt: true, parsedRows: true, totalRows: true }
  });
  if (!u) return res.status(404).json({ ok: false });
  res.json({ ok: true, upload: u });
});

router.post("/:id/parse", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const id = req.params.id;

  // ensure ownership
  const u = await prisma.upload.findFirst({ where: { id, uploadedBy: uid } });
  if (!u) return res.status(404).json({ ok: false, error: "not_found" });

  try {
    const result = await parseUpload(id);
    return res.json({ ok: true, ...result });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// DELETE /:id - delete upload and related events/anomalies (owner only)
router.delete("/:id", requireAuth, async (req, res) => {
  const uid = (req as any).auth.uid as string;
  const id = req.params.id;
  const u = await prisma.upload.findFirst({ where: { id, uploadedBy: uid } });
  if (!u) return res.status(404).json({ ok: false });

  try {
    // delete local file if present
    if (u.gcsUri) {
      try {
        await deleteLocalFile(u.gcsUri);
      } catch (e) {
        console.error("Error deleting local file for upload", id, e);
      }
    }

    await prisma.$transaction([
      prisma.anomaly.deleteMany({ where: { uploadId: id } }),
      prisma.event.deleteMany({ where: { uploadId: id } }),
      prisma.upload.delete({ where: { id } }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
