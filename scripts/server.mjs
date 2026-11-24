import "dotenv/config";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { attachOnlineRooms } from "./online-rooms.mjs";
import { GameDatabase } from "./database.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDirectory = path.join(projectRoot, "dist");
const dataDirectory = path.join(projectRoot, "data");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    let relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
    if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";

    const filePath = path.resolve(rootDirectory, relativePath);
    if (!filePath.startsWith(`${rootDirectory}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": fileStats.size,
      "Content-Type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });
const database = process.env.DATABASE_URL
  ? new GameDatabase(process.env.DATABASE_URL)
  : null;
if (database) {
  await database.initialize();
} else {
  console.warn("[db] DATABASE_URL is unset; online rooms use local JSON and game history is disabled.");
}
await attachOnlineRooms(io, dataDirectory, database);

async function shutdown() {
  await new Promise((resolve) => io.close(resolve));
  if (database) await database.close();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

const startServer = (port) => {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      startServer(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Chess18 is running at http://localhost:${port}`);
    console.log("Other devices can connect using this computer's LAN address.");
  });
};

startServer(Number(process.env.PORT ?? 4173));