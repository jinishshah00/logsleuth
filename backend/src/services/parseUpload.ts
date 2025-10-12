import fs from "fs";
import { Readable } from "stream";
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
  if (!upload.filePath) throw new Error("no file path on upload");
  const uri = upload.filePath;

  // obtain a readable stream from local FS
  if (!fs.existsSync(uri)) throw new Error("file not found on disk");
  const stream: Readable = fs.createReadStream(uri, { encoding: "utf-8" });

  await prisma.upload.update({ where: { id: uploadId }, data: { status: "PARSING", totalRows: 0, parsedRows: 0, errorText: null } });

  let res: { total: number; parsed: number } = { total: 0, parsed: 0 };
  const fmt = guessFormatFromPath(uri);
  try {
    switch (fmt) {
      case "zscaler_csv":
        res = await parseZscalerCsv(stream, uri, uploadId);
        break;
      case "apache":
        res = await parseApache(stream, uri, uploadId);
        break;
      default:
        // try as CSV first, then apache
        try {
          res = await parseZscalerCsv(stream, uri, uploadId);
        } catch {
          // try apache by re-opening the local file
          if (fs.existsSync(uri)) {
            const s2 = fs.createReadStream(uri);
            res = await parseApache(s2, uri, uploadId);
          } else {
            throw new Error("file not found for fallback parse");
          }
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
