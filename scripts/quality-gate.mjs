#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const checks = [];
const run = (label, command, args, options = {}) => {
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, env: { ...process.env, ...(options.env || {}) } });
  if (result.status !== 0) {
    console.error(`❌ ${label} failed`);
    process.exit(result.status || 1);
  }
  checks.push(`✅ ${label}`);
};

run("tests passed (with domain coverage floor)", "npm", ["run", "test:coverage"]);
// V12.1 · Static analysis. Rule ERRORS fail the gate (no-undef caught two
// real ReferenceErrors on its first run); warnings inform but don't block.
run("lint passed", "npm", ["run", "lint"]);
run("typecheck passed", "npm", ["run", "typecheck"]);
run("production build passed", "npm", ["run", "build"]);
run("size budgets", "npm", ["run", "check:budgets"]);
run("style discipline (v20 tree)", "npm", ["run", "check:styles"]);
run("tokens.css current", "node", ["scripts/gen-tokens.mjs", "--check"]);
run("demo build passed", "npm", ["run", "build"], { env: { VITE_DEMO_MODE: "true" } });

process.stdout.write("\n▶ secret scan\n");
const secretPatterns = [
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /OURA_CLIENT_SECRET/i,
  /ANTHROPIC_API_KEY/i,
  // A literal token value, not the field name: supabase-js's own auth code
  // reads `e.refresh_token` and is bundled whenever Supabase is configured.
  /refresh_token["']?\s*[:=]\s*["'`][A-Za-z0-9._-]{20,}["'`]/i,
  /sk-ant/i,
  // \b: require a boundary before "sk-" — the self-hosted Space Grotesk font
  // files ("...grotesk-latin-400-normal-<hash>.woff2") otherwise match this
  // generic key shape. Real keys ("sk-proj-…", "sk-ant-…") follow a quote,
  // space, or delimiter, so the boundary is always present for them.
  /\bsk-[A-Za-z0-9_-]{20,}/,
];
const scanFiles = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    else scanFiles.push(path);
  }
}
walk("dist");
const hits = [];
for (const file of scanFiles) {
  const text = readFileSync(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
  }
}
if (hits.length) {
  console.error("❌ secret scan failed");
  console.error(hits.join("\n"));
  process.exit(1);
}
checks.push("✅ secret scan clean");

process.stdout.write("\n▶ deploy artifact validation\n");
if (!existsSync("dist/index.html")) {
  console.error("❌ dist/index.html missing");
  process.exit(1);
}
const assets = existsSync("dist/assets") ? readdirSync("dist/assets") : [];
if (!assets.some(name => name.endsWith(".js"))) {
  console.error("❌ dist/assets JS bundle missing");
  process.exit(1);
}
checks.push("✅ deploy artifact ready");

console.log("\nQuality gate complete:");
for (const check of checks) console.log(check);
