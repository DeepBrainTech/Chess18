import { execFileSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");

execFileSync(process.execPath, [path.join(projectRoot, "node_modules/typescript/bin/tsc"), "-p", path.join(projectRoot, "tsconfig.json")], {
  cwd: projectRoot,
  stdio: "inherit",
});

await mkdir(path.join(outputDirectory, "vendor"), { recursive: true });
await Promise.all([
  copyFile(path.join(projectRoot, "index.html"), path.join(outputDirectory, "index.html")),
  copyFile(path.join(projectRoot, "src/style.css"), path.join(outputDirectory, "style.css")),
  copyFile(path.join(projectRoot, "node_modules/chess.js/dist/esm/chess.js"), path.join(outputDirectory, "vendor/chess.js")),
  copyFile(path.join(projectRoot, "node_modules/chess.js/LICENSE"), path.join(outputDirectory, "vendor/chess.js.LICENSE")),
]);

console.log(`Built Chess18 to ${path.relative(projectRoot, outputDirectory)}/`);