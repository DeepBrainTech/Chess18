import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const typescriptCli = path.join(projectRoot, "node_modules/typescript/bin/tsc");

const initialBuild = spawnSync(process.execPath, [path.join(projectRoot, "scripts/build.mjs")], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (initialBuild.error) throw initialBuild.error;
if (initialBuild.status !== 0) {
  process.exit(initialBuild.status ?? 1);
} else {
  const compiler = spawn(process.execPath, [typescriptCli, "--watch", "--preserveWatchOutput"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  const server = spawn(process.execPath, [path.join(projectRoot, "scripts/server.mjs")], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  const assetWatchers = [
    [path.join(projectRoot, "index.html"), path.join(outputDirectory, "index.html")],
    [path.join(projectRoot, "src/style.css"), path.join(outputDirectory, "style.css")],
  ].map(([source, destination]) => watch(source, () => {
    copyFile(source, destination).catch((error) => console.error(error));
  }));

  const stop = () => {
    compiler.kill();
    server.kill();
    assetWatchers.forEach((watcher) => watcher.close());
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  compiler.once("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
    stop();
  });
  server.once("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
    stop();
  });
}