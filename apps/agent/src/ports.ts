import net from "node:net";
import type { PortRange } from "./types";

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
