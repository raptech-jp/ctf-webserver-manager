import path from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";

async function listFiles(dir: string, baseDir = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath, baseDir)));
    } else if (entry.isFile()) {
      files.push(path.relative(baseDir, fullPath));
    }
  }
  return files;
}

export async function hashDirectory(dir: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const files = await listFiles(dir);
  files.sort();
  for (const relPath of files) {
    const fullPath = path.join(dir, relPath);
    const content = await fs.readFile(fullPath);
    hash.update(relPath);
    hash.update("\0");
    hash.update(content);
  }
  return `sha256:${hash.digest("hex")}`;
}
