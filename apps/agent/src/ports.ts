import net from "node:net";
import type { PortRange } from "./types.js";

export async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1" }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findAvailablePort(ranges: PortRange[], reserved: Set<number>): Promise<number> {
  for (const range of ranges) {
    for (let port = range.start; port <= range.end; port += 1) {
      if (reserved.has(port)) {
        continue;
      }
      if (await isPortAvailable(port)) {
        return port;
      }
    }
  }
  throw new Error("空きポートが見つかりませんでした");
}

function expandRanges(ranges: PortRange[]): number[] {
  const ports: number[] = [];
  for (const range of ranges) {
    for (let port = range.start; port <= range.end; port += 1) {
      ports.push(port);
    }
  }
  return ports;
}

export async function getPortSummary(
  ranges: PortRange[],
  concurrency = 40
): Promise<{ total: number; free: number }> {
  const ports = expandRanges(ranges);
  const total = ports.length;
  if (total === 0) {
    return { total: 0, free: 0 };
  }
  let index = 0;
  let free = 0;

  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (index < total) {
      const current = ports[index];
      index += 1;
      if (await isPortAvailable(current)) {
        free += 1;
      }
    }
  });

  await Promise.all(workers);
  return { total, free };
}
