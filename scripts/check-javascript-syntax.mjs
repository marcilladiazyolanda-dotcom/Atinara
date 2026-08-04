import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const excludedDirectories = new Set([".git", ".checkly", "node_modules", "playwright-report", "test-results"]);
const javascriptFiles = [];

function collectJavascriptFiles(directory) {
  readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) return;

    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJavascriptFiles(absolutePath);
      return;
    }

    if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))) {
      javascriptFiles.push(absolutePath);
    }
  });
}

const rootPath = fileURLToPath(projectRoot);
if (!statSync(rootPath).isDirectory()) {
  throw new Error("No se ha encontrado la raíz del proyecto.");
}

collectJavascriptFiles(rootPath);

const failures = javascriptFiles.flatMap((filePath) => {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    encoding: "utf8"
  });

  if (result.status === 0) return [];
  return [{
    file: relative(rootPath, filePath),
    output: `${result.stdout || ""}${result.stderr || ""}`.trim()
  }];
});

if (failures.length) {
  failures.forEach((failure) => {
    console.error(`\n${failure.file}\n${failure.output}`);
  });
  process.exitCode = 1;
} else {
  console.log(`Sintaxis válida en ${javascriptFiles.length} archivos JavaScript.`);
}
