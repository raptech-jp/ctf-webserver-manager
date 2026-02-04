import Database from "better-sqlite3";
import crypto from "node:crypto";
import type { Challenge, Instance, PortRange, Settings } from "./types";

const DEFAULT_PORT_RANGES: PortRange[] = [
  { start: 43000, end: 43100 },
];
const DEFAULT_MYSQL_DATABASE = "ctf";
const DEFAULT_MYSQL_USER = "root";

function generatePassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export type DbContext = {
  db: Database.Database;
};

export function initDb(dbPath: string): DbContext {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  const columns = ensureSettingsColumns(db);
  ensureSettings(db);
  normalizeSettings(db, columns);
  return { db };
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      port_ranges_json TEXT NOT NULL,
      host TEXT,
      host_scheme TEXT,
      mysql_root_password TEXT,
      mysql_database TEXT,
      mysql_user TEXT,
      mysql_password TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      runtime TEXT NOT NULL,
      runtime_version TEXT NOT NULL,
      db_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      files_hash TEXT NOT NULL,
      storage_path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      challenge_id TEXT NOT NULL,
      status TEXT NOT NULL,
      host_port INTEGER NOT NULL,
      container_port INTEGER NOT NULL,
      compose_project TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function ensureSettingsColumns(db: Database.Database): string[] {
  const columns = db
    .prepare("PRAGMA table_info(settings)")
    .all()
    .map((row) => (row as { name: string }).name);
  const addColumn = (name: string) => {
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE settings ADD COLUMN ${name} TEXT`);
    }
  };
  addColumn("mysql_root_password");
  addColumn("mysql_database");
  addColumn("mysql_user");
  addColumn("mysql_password");
  addColumn("host");
  addColumn("host_scheme");
  return columns;
}

function ensureSettings(db: Database.Database): void {
  const row = db.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!row) {
    const now = new Date().toISOString();
    const mysqlRootPassword = generatePassword();
    db.prepare(
      `INSERT INTO settings (
        id,
        port_ranges_json,
        host,
        host_scheme,
        mysql_root_password,
        mysql_database,
        mysql_user,
        mysql_password,
        created_at,
        updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      JSON.stringify(DEFAULT_PORT_RANGES),
      "",
      "http",
      mysqlRootPassword,
      DEFAULT_MYSQL_DATABASE,
      DEFAULT_MYSQL_USER,
      mysqlRootPassword,
      now,
      now
    );
  }
}

function normalizeSettings(db: Database.Database, columns: string[]): void {
  const current = getSettings(db);
  let changed = false;
  let host = current.host;
  if ((!host || host.trim() === "") && columns.includes("fqdn")) {
    const legacy = db.prepare("SELECT fqdn FROM settings WHERE id = 1").get() as
      | { fqdn?: string }
      | undefined;
    if (legacy?.fqdn) {
      host = legacy.fqdn;
      changed = true;
    }
  }
  if (!host) {
    host = "";
  }
  let mysqlRootPassword = current.mysql_root_password;
  if (!mysqlRootPassword) {
    mysqlRootPassword = generatePassword();
    changed = true;
  }
  let mysqlDatabase = current.mysql_database;
  if (!mysqlDatabase) {
    mysqlDatabase = DEFAULT_MYSQL_DATABASE;
    changed = true;
  }
  let mysqlUser = current.mysql_user;
  if (!mysqlUser) {
    mysqlUser = DEFAULT_MYSQL_USER;
    changed = true;
  }
  let mysqlPassword = current.mysql_password;
  if (!mysqlPassword) {
    mysqlPassword = mysqlUser === "root" ? mysqlRootPassword : generatePassword();
    changed = true;
  }
  let hostScheme = current.host_scheme;
  if (hostScheme !== "http" && hostScheme !== "https") {
    hostScheme = "http";
    changed = true;
  }
  if (changed) {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE settings SET
        host = ?,
        host_scheme = ?,
        mysql_root_password = ?,
        mysql_database = ?,
        mysql_user = ?,
        mysql_password = ?,
        updated_at = ?
      WHERE id = 1`
    ).run(
      host,
      hostScheme,
      mysqlRootPassword,
      mysqlDatabase,
      mysqlUser,
      mysqlPassword,
      now
    );
  }
}

export function getSettings(db: Database.Database): Settings {
  return db.prepare("SELECT * FROM settings WHERE id = 1").get() as Settings;
}

export type SettingsUpdate = {
  portRanges?: PortRange[];
  host?: string;
  hostScheme?: "http" | "https";
  mysqlRootPassword?: string;
  mysqlDatabase?: string;
  mysqlUser?: string;
  mysqlPassword?: string;
};

export function updateSettings(db: Database.Database, update: SettingsUpdate): Settings {
  const current = getSettings(db);
  const portRangesJson = update.portRanges
    ? JSON.stringify(update.portRanges)
    : current.port_ranges_json;
  const host = update.host ?? current.host ?? "";
  const hostScheme = update.hostScheme ?? current.host_scheme ?? "http";
  const mysqlRootPassword = update.mysqlRootPassword ?? current.mysql_root_password;
  const mysqlDatabase = update.mysqlDatabase ?? current.mysql_database;
  const mysqlUser = update.mysqlUser ?? current.mysql_user;
  const mysqlPassword = update.mysqlPassword ?? current.mysql_password;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE settings SET
      port_ranges_json = ?,
      host = ?,
      host_scheme = ?,
      mysql_root_password = ?,
      mysql_database = ?,
      mysql_user = ?,
      mysql_password = ?,
      updated_at = ?
     WHERE id = 1`
  ).run(
    portRangesJson,
    host,
    hostScheme,
    mysqlRootPassword,
    mysqlDatabase,
    mysqlUser,
    mysqlPassword,
    now
  );
  return getSettings(db);
}

export function listChallenges(db: Database.Database): Challenge[] {
  return db.prepare("SELECT * FROM challenges ORDER BY created_at DESC").all() as Challenge[];
}

export function getChallenge(db: Database.Database, id: string): Challenge | null {
  const row = db.prepare("SELECT * FROM challenges WHERE id = ?").get(id) as Challenge | undefined;
  return row ?? null;
}

export function insertChallenge(db: Database.Database, challenge: Challenge): void {
  db.prepare(
    `INSERT INTO challenges (
      id, name, runtime, runtime_version, db_type, created_at, updated_at, files_hash, storage_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    challenge.id,
    challenge.name,
    challenge.runtime,
    challenge.runtime_version,
    challenge.db_type,
    challenge.created_at,
    challenge.updated_at,
    challenge.files_hash,
    challenge.storage_path
  );
}

export function deleteChallenge(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM challenges WHERE id = ?").run(id);
}

export function listInstancesByChallenge(db: Database.Database, challengeId: string): Instance[] {
  return db
    .prepare("SELECT * FROM instances WHERE challenge_id = ? ORDER BY created_at DESC")
    .all(challengeId) as Instance[];
}

export function getLatestInstanceByChallenge(
  db: Database.Database,
  challengeId: string
): Instance | null {
  const row = db
    .prepare("SELECT * FROM instances WHERE challenge_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(challengeId) as Instance | undefined;
  return row ?? null;
}

export function listInstances(db: Database.Database): Instance[] {
  return db.prepare("SELECT * FROM instances ORDER BY created_at DESC").all() as Instance[];
}

export function listRunningInstances(db: Database.Database): Instance[] {
  return db
    .prepare("SELECT * FROM instances WHERE status = 'running' ORDER BY created_at DESC")
    .all() as Instance[];
}

export function getInstance(db: Database.Database, id: string): Instance | null {
  const row = db.prepare("SELECT * FROM instances WHERE id = ?").get(id) as Instance | undefined;
  return row ?? null;
}

export function insertInstance(db: Database.Database, instance: Instance): void {
  db.prepare(
    `INSERT INTO instances (
      id, challenge_id, status, host_port, container_port, compose_project, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    instance.id,
    instance.challenge_id,
    instance.status,
    instance.host_port,
    instance.container_port,
    instance.compose_project,
    instance.created_at,
    instance.updated_at
  );
}

export function updateInstanceStatus(
  db: Database.Database,
  id: string,
  status: Instance["status"]
): Instance | null {
  const now = new Date().toISOString();
  db.prepare("UPDATE instances SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  return getInstance(db, id);
}

export function updateInstanceAfterStart(
  db: Database.Database,
  id: string,
  status: Instance["status"],
  hostPort: number
): Instance | null {
  const now = new Date().toISOString();
  db.prepare("UPDATE instances SET status = ?, host_port = ?, updated_at = ? WHERE id = ?").run(
    status,
    hostPort,
    now,
    id
  );
  return getInstance(db, id);
}

export function deleteInstance(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM instances WHERE id = ?").run(id);
}

export function deleteInstancesByChallenge(db: Database.Database, challengeId: string): void {
  db.prepare("DELETE FROM instances WHERE challenge_id = ?").run(challengeId);
}
