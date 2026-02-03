import { spawn } from "node:child_process";

export type CommandResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

export async function composeUp(composeFile: string, project: string, cwd: string): Promise<CommandResult> {
  return await runCommand("docker", ["compose", "-f", composeFile, "-p", project, "up", "-d"], cwd);
}

export async function composeDown(
  composeFile: string,
  project: string,
  cwd: string
): Promise<CommandResult> {
  return await runCommand("docker", ["compose", "-f", composeFile, "-p", project, "down"], cwd);
}

export async function composeLogs(
  composeFile: string,
  project: string,
  cwd: string,
  tail: number
): Promise<CommandResult> {
  return await runCommand(
    "docker",
    ["compose", "-f", composeFile, "-p", project, "logs", "--tail", String(tail)],
    cwd
  );
}
