import { promises as fs } from "fs";
import path from "path";

const uploadRoot = process.env.UPLOAD_DIR || "./data/uploads";

export async function initLocalStore() {
  await fs.mkdir(uploadRoot, { recursive: true });
}

export async function saveBufferToLocal(filename: string, buf: Buffer): Promise<string> {
  await initLocalStore();
  // prefix with timestamp to avoid collisions
  const safe = filename.replace(/[^\w.\-]/g, "_");
  const fullPath = path.join(uploadRoot, `${Date.now()}_${safe}`);
  await fs.writeFile(fullPath, buf);
  return fullPath; // return local path we saved to
}
