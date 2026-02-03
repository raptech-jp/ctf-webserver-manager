import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import type { DbType, Runtime } from "./types";

export type ComposeParams = {
  runtime: Runtime;
  runtimeVersion: string;
  hostPort: number;
  dbType: DbType;
  dbRootPassword: string | null;
  dbDatabase: string | null;
  dbUser: string | null;
  dbPassword: string | null;
  dbInitExists: boolean;
};

function getRepoRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "..", "..");
}

function templatePath(runtime: Runtime, fileName: string): string {
  return path.join(getRepoRoot(), "templates", runtime, fileName);
}

function render(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{{${key}}}`).join(value);
  }
  return output;
}

export async function writeComposeFiles(
  composeDir: string,
  params: ComposeParams
): Promise<void> {
  await fs.mkdir(composeDir, { recursive: true });
  const composeTemplate = await fs.readFile(
    templatePath(params.runtime, "docker-compose.yml"),
    "utf8"
  );
  const dockerfileTemplate = await fs.readFile(
    templatePath(params.runtime, "Dockerfile"),
    "utf8"
  );

  const dbName = params.dbDatabase ?? "ctf";
  const appUser = params.dbUser ?? "root";
  const appPassword = appUser === "root" ? params.dbRootPassword ?? "" : params.dbPassword ?? "";
  const appEnv = params.dbType === "mysql"
    ? [
        "    environment:",
        "      MYSQL_HOST: db",
        `      MYSQL_USER: ${appUser}`,
        `      MYSQL_PASSWORD: ${appPassword}`,
        `      MYSQL_DATABASE: ${dbName}`,
      ].join("\n")
    : "";

  const dbDepends = params.dbType === "mysql"
    ? ["    depends_on:", "      - db"].join("\n")
    : "";

  const dbInitLine = params.dbInitExists
    ? "      - ../pack/db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro"
    : "";

  const mysqlEnv = [
    `      MYSQL_ROOT_PASSWORD: ${params.dbRootPassword ?? ""}`,
    `      MYSQL_DATABASE: ${dbName}`,
  ];
  if (appUser !== "root") {
    mysqlEnv.push(`      MYSQL_USER: ${appUser}`);
    mysqlEnv.push(`      MYSQL_PASSWORD: ${appPassword}`);
  }
  const mysqlService = params.dbType === "mysql"
    ? [
        "  db:",
        "    image: mysql:8",
        "    environment:",
        ...mysqlEnv,
        "    volumes:",
        "      - ../mysql-data:/var/lib/mysql",
        dbInitLine,
      ]
        .filter((line) => line !== "")
        .join("\n")
    : "";

  const compose = render(composeTemplate, {
    HOST_PORT: String(params.hostPort),
    RUNTIME_VERSION: params.runtimeVersion,
    APP_ENV: appEnv,
    DB_DEPENDS: dbDepends,
    MYSQL_SERVICE: mysqlService,
  });

  const dockerfile = render(dockerfileTemplate, {
    RUNTIME_VERSION: params.runtimeVersion,
  });

  await fs.writeFile(path.join(composeDir, "docker-compose.yml"), compose, "utf8");
  await fs.writeFile(path.join(composeDir, "Dockerfile"), dockerfile, "utf8");
}
