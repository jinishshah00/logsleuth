import fs from "fs";
import { prisma } from "../db";
import { parseZscalerCsv } from "../parsers/zscalerCsv";
import { parseApache } from "../parsers/apache";

function guessFormatFromPath(path: string): "zscaler_csv" | "apache" | "unknown" {
  const lower = path.toLowerCase();
  if (lower.endsWith(".csv")) return "zscaler_csv";
  if (lower.endsWith(".log") || lower.endsWith(".txt")) return "apache";
  return "unknown";
}

export async function parseUpload(uploadId: string) {
  const upload = await prisma.upload.findUnique({ where: { id: uploadId } });
  if (!upload) throw new Error("upload not found");
  if (!upload.gcsUri) throw new Error("no file path/uri on upload");
  const path = upload.gcsUri;

  if (!fs.existsSync(path)) throw new Error("file not found on disk");

  await prisma.upload.update({ where: { id: uploadId }, data: { status: "PARSING", totalRows: 0, parsedRows: 0, errorText: null } });

  let res: { total: number; parsed: number } = { total: 0, parsed: 0 };
  const fmt = guessFormatFromPath(path);
  try {
    switch (fmt) {
      case "zscaler_csv":
        res = await parseZscalerCsv(path, uploadId);
        break;
      case "apache":
        res = await parseApache(path, uploadId);
        break;
      default:
        // try as CSV first, then apache
        try {
          res = await parseZscalerCsv(path, uploadId);
        } catch {
          res = await parseApache(path, uploadId);
        }
        break;
    }
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "PARSED", totalRows: res.total, parsedRows: res.parsed },
    });
    return res;
  } catch (e: any) {
    await prisma.upload.update({
      where: { id: uploadId },
      data: { status: "FAILED", errorText: String(e?.message || e) },
    });
    throw e;
  }
}
