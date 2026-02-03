export type Runtime = "php" | "flask";
export type DbType = "none" | "mysql";

export type PortRange = {
  start: number;
  end: number;
};

export type Settings = {
  id: 1;
  port_ranges_json: string;
  mysql_root_password: string;
  mysql_database: string;
  mysql_user: string;
  mysql_password: string;
  created_at: string;
  updated_at: string;
};

export type Challenge = {
  id: string;
  name: string;
  runtime: Runtime;
  runtime_version: string;
  db_type: DbType;
  created_at: string;
  updated_at: string;
  files_hash: string;
  storage_path: string;
};

export type Instance = {
  id: string;
  challenge_id: string;
  status: "running" | "stopped" | "error";
  host_port: number;
  container_port: number;
  compose_project: string;
  created_at: string;
  updated_at: string;
};

export type Manifest = {
  schema_version: 1;
  challenge: {
    name: string;
    runtime: Runtime;
    runtime_version: string;
    db_type: DbType;
  };
  files: {
    hash: string;
  };
};
