import path from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import yauzl from "yauzl";
import { pipeline } from "node:stream/promises";

export async function saveStreamToFile(
  stream: NodeJS.ReadableStream,
  destPath: string
): Promise<string> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const hash = crypto.createHash("sha256");
  const writeStream = (await fs.open(destPath, "w")).createWriteStream();
  stream.on("data", (chunk) => {
    hash.update(chunk as Buffer);
  });
  await pipeline(stream, writeStream);
  return `sha256:${hash.digest("hex")}`;
}

function isSymlink(entry: yauzl.Entry): boolean {
  const mode = (entry.externalFileAttributes >> 16) & 0o170000;
  return mode === 0o120000;
}

function isUnsafePath(fileName: string): boolean {
  if (fileName.includes("\\")) {
    return true;
  }
  if (path.isAbsolute(fileName)) {
    return true;
  }
  const normalized = path.posix.normalize(fileName.replace(/\\/g, "/"));
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    return true;
  }
  if (normalized.includes(":") || normalized.startsWith("\\")) {
    return true;
  }
  return false;
}

export async function extractZipSafe(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error("ZIPを開けません"));
        return;
      }
      zip.readEntry();
      zip.on("entry", (entry: yauzl.Entry) => {
        if (isSymlink(entry)) {
          zip.close();
          reject(new Error("ZIP内のシンボリックリンクは許可されていません"));
          return;
        }
        const fileName = entry.fileName;
        if (isUnsafePath(fileName)) {
          zip.close();
          reject(new Error("ZIP内のパスが不正です"));
          return;
        }
        const destPath = path.resolve(destDir, fileName);
        if (!destPath.startsWith(path.resolve(destDir) + path.sep)) {
          zip.close();
          reject(new Error("ZIP内のパスが作業ディレクトリ外です"));
          return;
        }
        if (fileName.endsWith("/")) {
          fs.mkdir(destPath, { recursive: true })
            .then(() => zip.readEntry())
            .catch((mkdirErr) => {
              zip.close();
              reject(mkdirErr);
            });
          return;
        }
        zip.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            zip.close();
            reject(streamErr ?? new Error("ZIP読み込みに失敗しました"));
            return;
          }
          fs.mkdir(path.dirname(destPath), { recursive: true })
            .then(async () => {
              const writeStream = (await fs.open(destPath, "w")).createWriteStream();
              await pipeline(readStream, writeStream);
              zip.readEntry();
            })
            .catch((writeErr) => {
              zip.close();
              reject(writeErr);
            });
        });
      });
      zip.on("end", () => resolve());
      zip.on("error", (zipErr) => reject(zipErr));
    });
  });
}
