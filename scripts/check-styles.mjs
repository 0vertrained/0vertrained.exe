#!/usr/bin/env node
// Style discipline for the v20 tree (src/app, src/features, src/design,
// src/data): no hex colour outside the token sources, no static inline style
// objects (a CSS custom-property passthrough is fine), and no font size under
// 12px, the system's floor. Exits 1 with every offending line listed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app", "src/features", "src/design", "src/data"];
const TOKEN_SOURCES = new Set(["src/design/tokens.css", "src/design/tokens.json"]);
const problems = [];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

for (const file of ROOTS.flatMap((r) => walk(r))) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    if (line.includes("style-ok")) return;
    if (!TOKEN_SOURCES.has(file) && /(^|[^&\w])#[0-9a-fA-F]{3,8}\b/.test(line) && !/^\s*\/\//.test(line) && !/import|from ["']/.test(line)) {
      problems.push(`${where}: hex colour outside tokens — use a token (${line.trim()})`);
    }
    if (/style=\{\{/.test(line) && !/["']--/.test(line) && /:\s*(["']|\d)/.test(line.replace(/["']--[^"']+["']\s*:/g, ""))) {
      problems.push(`${where}: static inline style — move it to kit.css or a CSS Module (${line.trim()})`);
    }
    const px = line.match(/font(?:-size|Size)\s*[:=]\s*["']?(\d+(?:\.\d+)?)px/);
    if (px && Number(px[1]) < 12) problems.push(`${where}: font size ${px[1]}px is under the 12px floor`);
    const shorthand = line.match(/font:\s*\d+\s+(\d+(?:\.\d+)?)px/);
    if (shorthand && Number(shorthand[1]) < 12) problems.push(`${where}: font size ${shorthand[1]}px is under the 12px floor`);
  });
}

if (problems.length) {
  console.error(`check-styles: ${problems.length} problem(s)\n` + problems.join("\n"));
  process.exit(1);
}
console.log("check-styles: clean");
