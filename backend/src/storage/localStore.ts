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

export async function deleteLocalFile(localPath: string): Promise<void> {
  if (!localPath) return;
  try {
    // ensure the path is within the uploadRoot for safety
    const resolved = path.resolve(localPath);
    const rootResolved = path.resolve(uploadRoot);
    if (!resolved.startsWith(rootResolved)) {
      // don't delete files outside the uploads dir
      console.warn(`Refusing to delete file outside uploadRoot: ${resolved}`);
      return;
    }

    await fs.unlink(resolved);
  } catch (e: any) {
    // if the file doesn't exist, ignore; otherwise log
    if (e.code === "ENOENT") return;
    console.error("Failed to delete local file", localPath, e?.message || e);
  }
}
