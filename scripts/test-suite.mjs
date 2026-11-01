#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["netlify", "src"];
const testPattern = /\.(test|spec)\.(js|jsx|ts|tsx)$/;
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (testPattern.test(name)) files.push(`./${relative(process.cwd(), path).replaceAll("\\", "/")}`);
  }
}

for (const root of roots) walk(root);
files.sort();

// A bounded batch keeps jsdom's memory footprint stable on local machines and CI.
const batchSize = Math.max(1, Number.parseInt(process.env.VITEST_BATCH_SIZE || "8", 10));
const executable = process.platform === "win32" ? "npx.cmd" : "npx";

for (let index = 0; index < files.length; index += batchSize) {
  const batch = files.slice(index, index + batchSize);
  const number = Math.floor(index / batchSize) + 1;
  const total = Math.ceil(files.length / batchSize);
  console.log(`\n▶ test batch ${number}/${total} (${batch.length} files)`);
  const result = spawnSync(executable, ["vitest", "run", ...batch, "--maxWorkers=4", "--reporter=dot"], {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`\n✅ ${files.length} test files passed`);
