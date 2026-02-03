import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

export type AppPaths = {
  appDataRoot: string;
  baseDir: string;
  storageDir: string;
  challengesDir: string;
  workdirsDir: string;
  tmpDir: string;
  exportsDir: string;
  dbPath: string;
};

export function getAppDataRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, "..", "..", "..");
  return path.join(repoRoot, ".appdata");
}

export function getPaths(): AppPaths {
  const appDataRoot = getAppDataRoot();
  const baseDir = path.join(appDataRoot, "ctf-web-launcher");
  const storageDir = path.join(baseDir, "storage");
  return {
    appDataRoot,
    baseDir,
    storageDir,
    challengesDir: path.join(storageDir, "challenges"),
    workdirsDir: path.join(storageDir, "workdirs"),
    tmpDir: path.join(storageDir, "tmp"),
    exportsDir: path.join(storageDir, "exports"),
    dbPath: path.join(baseDir, "db.sqlite"),
  };
}

export async function ensureBaseDirs(paths: AppPaths): Promise<void> {
  await fs.mkdir(paths.baseDir, { recursive: true });
  await fs.mkdir(paths.storageDir, { recursive: true });
  await fs.mkdir(paths.challengesDir, { recursive: true });
  await fs.mkdir(paths.workdirsDir, { recursive: true });
  await fs.mkdir(paths.tmpDir, { recursive: true });
  await fs.mkdir(paths.exportsDir, { recursive: true });
}

export function resolveWorkdir(paths: AppPaths, instanceId: string): string {
  return path.join(paths.workdirsDir, instanceId);
}

export function resolveChallengeDir(paths: AppPaths, challengeId: string): string {
  return path.join(paths.challengesDir, challengeId);
}
