import path from "node:path";
import { promises as fs } from "node:fs";

async function removeJunkEntries(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === ".DS_Store") {
      await fs.rm(fullPath, { force: true });
      continue;
    }
    if (entry.name === "__MACOSX" && entry.isDirectory()) {
      await fs.rm(fullPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      await removeJunkEntries(fullPath);
    }
  }
}

async function flattenSingleTopDir(rootDir: string): Promise<void> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const filtered = entries.filter(
    (entry) => entry.name !== ".DS_Store" && entry.name !== "__MACOSX"
  );
  if (filtered.length !== 1) {
    return;
  }
  const only = filtered[0];
  if (!only.isDirectory()) {
    return;
  }
  const innerDir = path.join(rootDir, only.name);
  const innerEntries = await fs.readdir(innerDir, { withFileTypes: true });
  for (const entry of innerEntries) {
    const from = path.join(innerDir, entry.name);
    const to = path.join(rootDir, entry.name);
    await fs.rename(from, to);
  }
  await fs.rm(innerDir, { recursive: true, force: true });
}

export async function normalizeExtractedPack(rootDir: string): Promise<void> {
  await removeJunkEntries(rootDir);
  await flattenSingleTopDir(rootDir);
  await removeJunkEntries(rootDir);
}

export async function assertDocrootIndex(rootDir: string): Promise<void> {
  const indexHtml = path.join(rootDir, "index.html");
  const indexPhp = path.join(rootDir, "index.php");
  const hasIndexHtml = await fs
    .stat(indexHtml)
    .then((stat) => stat.isFile())
    .catch(() => false);
  const hasIndexPhp = await fs
    .stat(indexPhp)
    .then((stat) => stat.isFile())
    .catch(() => false);
  if (!hasIndexHtml && !hasIndexPhp) {
    throw new Error("docroot直下にindex.htmlまたはindex.phpが必要です");
  }
}
