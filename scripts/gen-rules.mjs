#!/usr/bin/env node
// Writes the game-rules block of README.md from src/domain/game/config.ts.
// Runs the TypeScript source directly (Node's type stripping), so there is
// no build step; rulesDoc.test.ts fails whenever the README is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = resolve(root, "README.md");

// A child process keeps the strip-types flag out of every other npm script;
// ts-resolve.mjs lets Node follow the app's extensionless imports.
const rendered = execFileSync(process.execPath, [
  "--experimental-strip-types",
  "--no-warnings",
  `--import=${pathToFileURL(resolve(root, "scripts/ts-resolve.mjs")).href}`,
  "--input-type=module",
  "-e",
  `import { renderRulesMarkdown, spliceRules } from ${JSON.stringify(resolve(root, "src/domain/game/rulesDoc.ts"))};
   const readme = ${JSON.stringify(readFileSync(readmePath, "utf8"))};
   process.stdout.write(spliceRules(readme, renderRulesMarkdown()));`,
], { encoding: "utf8", maxBuffer: 1 << 24 });

const before = readFileSync(readmePath, "utf8");
if (rendered === before) {
  console.log("gen-rules: README.md game rules already current");
} else {
  writeFileSync(readmePath, rendered);
  console.log("gen-rules: README.md game rules updated");
}
