import { Storage } from "@google-cloud/storage";
import { Readable } from "stream";
import crypto from "crypto";

const storage = new Storage();
const bucketName = process.env.GCS_BUCKET || (`logsleuth-${process.env.NODE_ENV || "dev"}`);

if (!bucketName) throw new Error("GCS bucket not configured (GCS_BUCKET)");

const bucket = storage.bucket(bucketName);

function makeObjectName(filename: string) {
  const safe = filename.replace(/[^\w.\-]/g, "_");
  const rand = crypto.randomBytes(6).toString("hex");
  return `${Date.now()}_${rand}_${safe}`;
}

export async function saveBufferToGCS(filename: string, buf: Buffer): Promise<string> {
  const name = makeObjectName(filename);
  const file = bucket.file(name);
  const stream = new Readable();
  stream.push(buf);
  stream.push(null);

  return new Promise<string>((resolve, reject) => {
    const writeStream = file.createWriteStream({ resumable: false, predefinedAcl: "private" });
    stream.pipe(writeStream)
      .on("error", (err) => reject(err))
      .on("finish", () => resolve(`gs://${bucket.name}/${name}`));
  });
}

export function getGcsReadStream(gcsUri: string): Readable {
  // expect gs://bucket/name or bucket/name
  let uri = gcsUri;
  if (uri.startsWith("gs://")) uri = uri.slice(5);
  // split first / into bucket/name
  const firstSlash = uri.indexOf("/");
  let name = uri;
  if (firstSlash >= 0) name = uri.slice(firstSlash + 1);
  return bucket.file(name).createReadStream();
}

export async function deleteGcsObject(gcsUri: string): Promise<void> {
  if (!gcsUri) return;
  let uri = gcsUri;
  if (uri.startsWith("gs://")) uri = uri.slice(5);
  const firstSlash = uri.indexOf("/");
  let name = uri;
  if (firstSlash >= 0) name = uri.slice(firstSlash + 1);
  try {
    await bucket.file(name).delete();
  } catch (e: any) {
    if (e.code === 404) return;
    console.error("Failed to delete GCS object", gcsUri, e?.message || e);
  }
}

export function gcsUriToObjectName(gcsUri: string): string {
  if (!gcsUri) return gcsUri;
  if (gcsUri.startsWith("gs://")) return gcsUri.slice(5).split("/").slice(1).join("/");
  return gcsUri.split("/").slice(1).join("/");
}
