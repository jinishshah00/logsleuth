import fs from "fs";
import { Readable } from "stream";
import { prisma } from "../db";
import { parseZscalerCsv } from "../parsers/zscalerCsv";
import { parseApache } from "../parsers/apache";
import { getGcsReadStream } from "../storage/gcsStore";

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
  const uri = upload.gcsUri;

  // obtain a readable stream from GCS or local FS
  let stream: Readable;
  if (uri.startsWith("gs://")) {
    stream = getGcsReadStream(uri);
  } else {
    if (!fs.existsSync(uri)) throw new Error("file not found on disk");
    stream = fs.createReadStream(uri, { encoding: "utf-8" });
  }

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
          // reopen stream for apache attempt if from local file
          if (!uri.startsWith("gs://") && fs.existsSync(uri)) {
            const s2 = fs.createReadStream(uri);
            res = await parseApache(s2, uri, uploadId);
          } else {
            // for GCS, re-acquire read stream
            const s2 = getGcsReadStream(uri);
            res = await parseApache(s2, uri, uploadId);
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
