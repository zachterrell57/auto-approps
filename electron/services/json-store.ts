import fs from "node:fs";
import path from "node:path";

/**
 * Atomically write a JSON-serializable value to a file.
 * Writes to a temporary file first, then renames into place so a crash
 * mid-write cannot corrupt the target file.
 */
export function atomicWriteJsonSync(
  filePath: string,
  data: unknown,
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const payload = JSON.stringify(data, null, 2) + "\n";
  const tmpPath = filePath + ".tmp";

  try {
    fs.writeFileSync(tmpPath, payload, "utf-8");
    fs.renameSync(tmpPath, filePath);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Best-effort cleanup — file may already be gone after successful rename.
    }
  }
}
