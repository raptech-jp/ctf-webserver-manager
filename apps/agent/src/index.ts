import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import path from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { ensureBaseDirs, getPaths, resolveChallengeDir, resolveWorkdir } from "./storage";
import {
  getSettings,
  initDb,
  insertChallenge,
  insertInstance,
  listChallenges,
  listInstancesByChallenge,
  listRunningInstances,
  getLatestInstanceByChallenge,
  updateInstanceStatus,
  updateInstanceAfterStart,
  getChallenge,
  getInstance,
  updateSettings,
  deleteInstance,
  deleteChallenge,
  deleteInstancesByChallenge,
} from "./db";
import type { DbType, Manifest, PortRange, Runtime, Settings } from "./types";
import { extractZipSafe, saveStreamToFile } from "./zip";
import { hashDirectory } from "./hash";
import { findAvailablePort, isPortAvailable } from "./ports";
import { writeComposeFiles } from "./templates";
import { composeDown, composeLogs, composeUp } from "./docker";
import { assertDocrootIndex, normalizeExtractedPack } from "./pack";
import archiver from "archiver";

const paths = getPaths();
await ensureBaseDirs(paths);

const { db } = initDb(paths.dbPath);

const server = Fastify({ logger: true });

const defaultOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
const allowedOrigins = new Set(
  (process.env.WEB_ORIGIN ? process.env.WEB_ORIGIN.split(",") : defaultOrigins)
    .map((origin) => origin.trim())
    .filter(Boolean)
);

await server.register(cors, {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.has(origin)) {
      cb(null, true);
      return;
    }
    cb(new Error("CORS: 許可されていないOriginです"), false);
  },
});

await server.register(multipart, {
  attachFieldsToBody: false,
});

function assertRuntime(value: string): asserts value is Runtime {
  if (value !== "php" && value !== "flask") {
    throw new Error("runtimeが不正です");
  }
}

function assertDbType(value: string): asserts value is DbType {
  if (value !== "none" && value !== "mysql") {
    throw new Error("db_typeが不正です");
  }
}

function parsePortRanges(input: unknown): PortRange[] {
  if (!Array.isArray(input)) {
    throw new Error("port_rangesが不正です");
  }
  const ranges: PortRange[] = input.map((range) => {
    if (
      !range ||
      typeof range !== "object" ||
      typeof (range as PortRange).start !== "number" ||
      typeof (range as PortRange).end !== "number"
    ) {
      throw new Error("port_rangesが不正です");
    }
    return { start: (range as PortRange).start, end: (range as PortRange).end };
  });
  for (const range of ranges) {
    if (range.start < 1 || range.end > 65535 || range.start > range.end) {
      throw new Error("port_rangesの範囲が不正です");
    }
  }
  return ranges;
}

async function parseMultipart(request: FastifyRequest): Promise<{
  zipPath: string;
  zipHash: string;
  metadata: Record<string, unknown> | null;
}> {
  let metadataRaw: string | null = null;
  let zipPath: string | null = null;
  let zipHash: string | null = null;

  const parts = (request as FastifyRequest & { parts: () => AsyncIterable<any> }).parts();
  for await (const part of parts) {
    if (part.type === "file") {
      if (!part.filename) {
        continue;
      }
      if (part.fieldname !== "zip") {
        continue;
      }
      const fileId = crypto.randomUUID();
      const target = path.join(paths.tmpDir, `${fileId}.zip`);
      zipHash = await saveStreamToFile(part.file, target);
      zipPath = target;
    } else if (part.type === "field") {
      if (part.fieldname === "metadata") {
        metadataRaw = part.value;
      }
    }
  }

  if (!zipPath || !zipHash) {
    throw new Error("ZIPファイルが必要です");
  }

  const metadata = metadataRaw ? (JSON.parse(metadataRaw) as Record<string, unknown>) : null;

  return { zipPath, zipHash, metadata };
}

function getContainerPort(runtime: Runtime): number {
  return runtime === "php" ? 80 : 8000;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(src, dest, { recursive: true });
}

function getComposeFilePath(workdir: string): string {
  return path.join(workdir, "compose", "docker-compose.yml");
}

type MysqlSecrets = {
  mysql_root_password: string;
  mysql_database: string;
  mysql_user: string;
  mysql_password: string;
};

async function readMysqlSecretsFile(workdir: string): Promise<Partial<MysqlSecrets> | null> {
  const secretPath = path.join(workdir, "secrets.json");
  const exists = await fs
    .stat(secretPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    return null;
  }
  const content = await fs.readFile(secretPath, "utf8");
  return JSON.parse(content) as Partial<MysqlSecrets>;
}

async function writeMysqlSecrets(workdir: string, secrets: MysqlSecrets): Promise<void> {
  await fs.writeFile(path.join(workdir, "secrets.json"), JSON.stringify(secrets, null, 2), "utf8");
}

function getMysqlSettings(settings: Settings): MysqlSecrets {
  return {
    mysql_root_password: settings.mysql_root_password,
    mysql_database: settings.mysql_database,
    mysql_user: settings.mysql_user,
    mysql_password:
      settings.mysql_user === "root" ? settings.mysql_root_password : settings.mysql_password,
  };
}

async function loadMysqlSecrets(workdir: string, settings: Settings): Promise<MysqlSecrets> {
  const base = getMysqlSettings(settings);
  const fromFile = await readMysqlSecretsFile(workdir);
  const mysqlRootPassword = fromFile?.mysql_root_password ?? base.mysql_root_password;
  const mysqlDatabase = fromFile?.mysql_database ?? base.mysql_database;
  const mysqlUser = fromFile?.mysql_user ?? base.mysql_user;
  let mysqlPassword = fromFile?.mysql_password ?? base.mysql_password;
  if (mysqlUser === "root") {
    mysqlPassword = mysqlRootPassword;
  }
  const secrets = { mysql_root_password: mysqlRootPassword, mysql_database: mysqlDatabase, mysql_user: mysqlUser, mysql_password: mysqlPassword };
  await writeMysqlSecrets(workdir, secrets);
  return secrets;
}

server.get("/health", async () => ({ status: "ok" }));

server.get("/settings", async () => {
  const settings = getSettings(db);
  return {
    port_ranges: JSON.parse(settings.port_ranges_json) as PortRange[],
    mysql_root_password: settings.mysql_root_password,
    mysql_database: settings.mysql_database,
    mysql_user: settings.mysql_user,
    mysql_password: settings.mysql_password,
    updated_at: settings.updated_at,
  };
});

server.put("/settings", async (request, reply) => {
  try {
    const body = request.body as {
      port_ranges?: unknown;
      mysql_root_password?: unknown;
      mysql_database?: unknown;
      mysql_user?: unknown;
      mysql_password?: unknown;
    };
    const ranges = parsePortRanges(body?.port_ranges);
    const mysqlRootPassword = String(body?.mysql_root_password ?? "").trim();
    const mysqlDatabase = String(body?.mysql_database ?? "").trim();
    const mysqlUser = String(body?.mysql_user ?? "").trim();
    let mysqlPassword = String(body?.mysql_password ?? "").trim();

    if (!mysqlRootPassword || !mysqlDatabase || !mysqlUser) {
      throw new Error("MySQL認証情報が不正です");
    }
    if (mysqlUser === "root") {
      mysqlPassword = mysqlRootPassword;
    }
    if (!mysqlPassword) {
      throw new Error("MySQL認証情報が不正です");
    }

    const settings = updateSettings(db, {
      portRanges: ranges,
      mysqlRootPassword,
      mysqlDatabase,
      mysqlUser,
      mysqlPassword,
    });
    reply.send({
      port_ranges: JSON.parse(settings.port_ranges_json),
      mysql_root_password: settings.mysql_root_password,
      mysql_database: settings.mysql_database,
      mysql_user: settings.mysql_user,
      mysql_password: settings.mysql_password,
      updated_at: settings.updated_at,
    });
  } catch (error) {
    reply.status(400).send({ error: (error as Error).message });
  }
});

server.post("/challenges", async (request, reply) => {
  try {
    const { zipPath, metadata } = await parseMultipart(request);
    if (!metadata) {
      throw new Error("metadataが必要です");
    }
    const name = String(metadata.name ?? "").trim();
    const runtime = String(metadata.runtime ?? "").trim();
    const runtimeVersion = String(metadata.runtime_version ?? "").trim();
    const dbType = String(metadata.db_type ?? "").trim();

    if (!name || !runtime || !runtimeVersion || !dbType) {
      throw new Error("metadataが不足しています");
    }
    assertRuntime(runtime);
    assertDbType(dbType);

    const challengeId = crypto.randomUUID();
    const challengeDir = resolveChallengeDir(paths, challengeId);
    const filesDir = path.join(challengeDir, "files");
    await fs.mkdir(filesDir, { recursive: true });
    await extractZipSafe(zipPath, filesDir);
    await normalizeExtractedPack(filesDir);
    if (runtime === "php") {
      await assertDocrootIndex(filesDir);
    }

    const filesHash = await hashDirectory(filesDir);
    const now = new Date().toISOString();
    insertChallenge(db, {
      id: challengeId,
      name,
      runtime,
      runtime_version: runtimeVersion,
      db_type: dbType,
      created_at: now,
      updated_at: now,
      files_hash: filesHash,
      storage_path: challengeDir,
    });

    await fs.unlink(zipPath).catch(() => undefined);

    reply.send({ id: challengeId });
  } catch (error) {
    reply.status(400).send({ error: (error as Error).message });
  }
});

server.get("/challenges", async () => {
  return listChallenges(db);
});

server.get("/challenges/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const challenge = getChallenge(db, id);
  if (!challenge) {
    reply.status(404).send({ error: "challengeが見つかりません" });
    return;
  }
  const instances = listInstancesByChallenge(db, id);
  reply.send({ challenge, instances });
});

server.post("/instances", async (request, reply) => {
  try {
    const body = request.body as { challenge_id?: string };
    const challengeId = String(body?.challenge_id ?? "").trim();
    if (!challengeId) {
      throw new Error("challenge_idが必要です");
    }
    const challenge = getChallenge(db, challengeId);
    if (!challenge) {
      reply.status(404).send({ error: "challengeが見つかりません" });
      return;
    }

    const latestInstance = getLatestInstanceByChallenge(db, challengeId);
    if (latestInstance) {
      if (latestInstance.status === "running") {
        reply.status(409).send({ error: "既に起動中です" });
        return;
      }

      const workdir = resolveWorkdir(paths, latestInstance.id);
      const composeDir = path.join(workdir, "compose");
      const packDir = path.join(workdir, "pack");
      const composeFile = getComposeFilePath(workdir);
      const packExists = await fs
        .stat(packDir)
        .then((stat) => stat.isDirectory())
        .catch(() => false);
      const composeExists = await fs
        .stat(composeFile)
        .then((stat) => stat.isFile())
        .catch(() => false);

      if (packExists && composeExists) {
        const settings = getSettings(db);
        const ranges = JSON.parse(settings.port_ranges_json) as PortRange[];
        const reservedPorts = new Set(listRunningInstances(db).map((instance) => instance.host_port));
        let hostPort = latestInstance.host_port;

        if (reservedPorts.has(hostPort)) {
          hostPort = await findAvailablePort(ranges, reservedPorts);
        } else {
          const available = await isPortAvailable(hostPort);
          if (!available) {
            hostPort = await findAvailablePort(ranges, reservedPorts);
          }
        }

        const dbInitExists = await fs
          .stat(path.join(packDir, "db", "init.sql"))
          .then(() => true)
          .catch(() => false);
        const mysqlSecrets =
          challenge.db_type === "mysql" ? await loadMysqlSecrets(workdir, settings) : null;

        await writeComposeFiles(composeDir, {
          runtime: challenge.runtime,
          runtimeVersion: challenge.runtime_version,
          hostPort,
          dbType: challenge.db_type,
          dbRootPassword: mysqlSecrets?.mysql_root_password ?? null,
          dbDatabase: mysqlSecrets?.mysql_database ?? null,
          dbUser: mysqlSecrets?.mysql_user ?? null,
          dbPassword: mysqlSecrets?.mysql_password ?? null,
          dbInitExists,
        });

        const composeResult = await composeUp(composeFile, latestInstance.compose_project, workdir);
        if (composeResult.code !== 0) {
          reply.status(500).send({ error: composeResult.stderr || "起動に失敗しました" });
          return;
        }

        const updated = updateInstanceAfterStart(db, latestInstance.id, "running", hostPort);
        reply.send({ id: latestInstance.id, host_port: hostPort, instance: updated });
        return;
      }

      await fs.rm(workdir, { recursive: true, force: true }).catch(() => undefined);
      deleteInstance(db, latestInstance.id);
    }

    const settings = getSettings(db);
    const ranges = JSON.parse(settings.port_ranges_json) as PortRange[];
    const reservedPorts = new Set(listRunningInstances(db).map((instance) => instance.host_port));
    const hostPort = await findAvailablePort(ranges, reservedPorts);
    const containerPort = getContainerPort(challenge.runtime);

    const instanceId = crypto.randomUUID();
    const workdir = resolveWorkdir(paths, instanceId);
    const packDir = path.join(workdir, "pack");
    const composeDir = path.join(workdir, "compose");

    await copyDir(path.join(challenge.storage_path, "files"), packDir);

    const dbInitExists = await fs
      .stat(path.join(packDir, "db", "init.sql"))
      .then(() => true)
      .catch(() => false);

    const mysqlSecrets =
      challenge.db_type === "mysql" ? await loadMysqlSecrets(workdir, settings) : null;

    await writeComposeFiles(composeDir, {
      runtime: challenge.runtime,
      runtimeVersion: challenge.runtime_version,
      hostPort,
      dbType: challenge.db_type,
      dbRootPassword: mysqlSecrets?.mysql_root_password ?? null,
      dbDatabase: mysqlSecrets?.mysql_database ?? null,
      dbUser: mysqlSecrets?.mysql_user ?? null,
      dbPassword: mysqlSecrets?.mysql_password ?? null,
      dbInitExists,
    });

    const composeProject = `ctfwl_${instanceId.replace(/-/g, "")}`;
    const composeFile = getComposeFilePath(workdir);
    const composeResult = await composeUp(composeFile, composeProject, workdir);

    const status = composeResult.code === 0 ? "running" : "error";
    const now = new Date().toISOString();
    insertInstance(db, {
      id: instanceId,
      challenge_id: challengeId,
      status,
      host_port: hostPort,
      container_port: containerPort,
      compose_project: composeProject,
      created_at: now,
      updated_at: now,
    });

    if (composeResult.code !== 0) {
      reply.status(500).send({ error: composeResult.stderr || "起動に失敗しました" });
      return;
    }

    reply.send({ id: instanceId, host_port: hostPort });
  } catch (error) {
    reply.status(400).send({ error: (error as Error).message });
  }
});

server.post("/instances/:id/stop", async (request, reply) => {
  const { id } = request.params as { id: string };
  const instance = getInstance(db, id);
  if (!instance) {
    reply.status(404).send({ error: "instanceが見つかりません" });
    return;
  }
  const workdir = resolveWorkdir(paths, id);
  const composeFile = getComposeFilePath(workdir);
  const result = await composeDown(composeFile, instance.compose_project, workdir);
  if (result.code !== 0) {
    reply.status(500).send({ error: result.stderr || "停止に失敗しました" });
    return;
  }
  const updated = updateInstanceStatus(db, id, "stopped");
  reply.send(updated);
});

server.delete("/instances/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const instance = getInstance(db, id);
  if (!instance) {
    reply.status(404).send({ error: "instanceが見つかりません" });
    return;
  }
  const workdir = resolveWorkdir(paths, id);
  const composeFile = getComposeFilePath(workdir);
  if (instance.status === "running") {
    const result = await composeDown(composeFile, instance.compose_project, workdir);
    if (result.code !== 0) {
      reply.status(500).send({ error: result.stderr || "停止に失敗しました" });
      return;
    }
  }
  deleteInstance(db, id);
  await fs.rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  reply.send({ status: "deleted" });
});

server.get("/instances/:id/logs", async (request, reply) => {
  const { id } = request.params as { id: string };
  const tail = Number((request.query as { tail?: string }).tail ?? "200");
  const instance = getInstance(db, id);
  if (!instance) {
    reply.status(404).send({ error: "instanceが見つかりません" });
    return;
  }
  const workdir = resolveWorkdir(paths, id);
  const composeFile = getComposeFilePath(workdir);
  const result = await composeLogs(composeFile, instance.compose_project, workdir, tail);
  if (result.code !== 0) {
    reply.status(500).send({ error: result.stderr || "ログ取得に失敗しました" });
    return;
  }
  reply.send({ logs: result.stdout });
});

server.post("/challenges/:id/export", async (request, reply) => {
  const { id } = request.params as { id: string };
  const challenge = getChallenge(db, id);
  if (!challenge) {
    reply.status(404).send({ error: "challengeが見つかりません" });
    return;
  }

  const filesDir = path.join(challenge.storage_path, "files");
  const manifest: Manifest = {
    schema_version: 1,
    challenge: {
      name: challenge.name,
      runtime: challenge.runtime,
      runtime_version: challenge.runtime_version,
      db_type: challenge.db_type,
    },
    files: {
      hash: challenge.files_hash,
    },
  };

  reply.header("Content-Type", "application/zip");
  reply.header("Content-Disposition", "attachment; filename=challenge-pack.zip");

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  archive.directory(filesDir, "files");
  archive.finalize();
  reply.send(archive);
});

server.delete("/challenges/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const challenge = getChallenge(db, id);
  if (!challenge) {
    reply.status(404).send({ error: "challengeが見つかりません" });
    return;
  }

  const instances = listInstancesByChallenge(db, id);
  for (const instance of instances) {
    const workdir = resolveWorkdir(paths, instance.id);
    const composeFile = getComposeFilePath(workdir);
    if (instance.status === "running") {
      const result = await composeDown(composeFile, instance.compose_project, workdir);
      if (result.code !== 0) {
        reply.status(500).send({ error: result.stderr || "停止に失敗しました" });
        return;
      }
    }
    await fs.rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }

  deleteInstancesByChallenge(db, id);
  deleteChallenge(db, id);
  await fs.rm(challenge.storage_path, { recursive: true, force: true }).catch(() => undefined);

  reply.send({ status: "deleted" });
});

server.post("/import", async (request, reply) => {
  try {
    const { zipPath, metadata } = await parseMultipart(request);
    const tempDir = path.join(paths.tmpDir, crypto.randomUUID());
    await extractZipSafe(zipPath, tempDir);

    const manifestPath = path.join(tempDir, "manifest.json");
    let manifest: Manifest | null = null;
    const hasManifest = await fs
      .stat(manifestPath)
      .then(() => true)
      .catch(() => false);

    if (hasManifest) {
      manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Manifest;
      if (!manifest.challenge || !manifest.files) {
        throw new Error("manifest.jsonが不正です");
      }
    }

    const name = manifest?.challenge?.name ?? String(metadata?.name ?? "").trim();
    const runtime = manifest?.challenge?.runtime ?? String(metadata?.runtime ?? "").trim();
    const runtimeVersion =
      manifest?.challenge?.runtime_version ?? String(metadata?.runtime_version ?? "").trim();
    const dbType = manifest?.challenge?.db_type ?? String(metadata?.db_type ?? "").trim();

    if (!name || !runtime || !runtimeVersion || !dbType) {
      throw new Error("metadataが不足しています");
    }

    assertRuntime(runtime);
    assertDbType(dbType);

    const filesDirCandidate = path.join(tempDir, "files");
    const filesDir = await fs
      .stat(filesDirCandidate)
      .then((stat) => (stat.isDirectory() ? filesDirCandidate : tempDir))
      .catch(() => tempDir);

    await normalizeExtractedPack(filesDir);
    if (runtime === "php") {
      await assertDocrootIndex(filesDir);
    }

    const challengeId = crypto.randomUUID();
    const challengeDir = resolveChallengeDir(paths, challengeId);
    const destFilesDir = path.join(challengeDir, "files");

    await copyDir(filesDir, destFilesDir);
    const filesHash = manifest?.files?.hash ?? (await hashDirectory(destFilesDir));

    const now = new Date().toISOString();
    insertChallenge(db, {
      id: challengeId,
      name,
      runtime,
      runtime_version: runtimeVersion,
      db_type: dbType,
      created_at: now,
      updated_at: now,
      files_hash: filesHash,
      storage_path: challengeDir,
    });

    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.unlink(zipPath).catch(() => undefined);

    reply.send({ id: challengeId });
  } catch (error) {
    reply.status(400).send({ error: (error as Error).message });
  }
});

const port = Number(process.env.AGENT_PORT ?? "43765");
const host = process.env.AGENT_HOST ?? "127.0.0.1";

server.listen({ port, host }, (err, address) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  server.log.info(`Agent listening on ${address}`);
});
