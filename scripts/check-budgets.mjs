#!/usr/bin/env node
// Size budgets on the production build, read from Vite's manifest:
//   - /next initial JS (the entry plus everything src/app/main.tsx imports
//     statically) <= 120 KB gzip, so the new app paints fast on a phone;
//   - every chunk reachable from src/app/main.tsx, lazy ones included,
//     <= 250 KB gzip;
//   - the design system's font files <= 120 KB.
// Run after `npm run build`. Exits 1 over budget.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET = { initialKb: 120, totalKb: 250, fontsKb: 120 };
const DIST = "dist";
const manifestPath = join(DIST, ".vite", "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("check-budgets: dist/.vite/manifest.json missing; run the build first.");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const gzipKb = (file) => gzipSync(readFileSync(join(DIST, file))).length / 1024;

// The legacy app is a sibling lazy chunk of the same entry; it is never part
// of /next, so the walk stops at its door.
const isLegacy = (key) => key.startsWith("src/legacy/");

function reach(key, { dynamic }) {
  const seen = new Set();
  const stack = [key];
  while (stack.length) {
    const k = stack.pop();
    if (!k || seen.has(k) || !manifest[k] || isLegacy(k)) continue;
    seen.add(k);
    for (const dep of manifest[k].imports ?? []) stack.push(dep);
    if (dynamic) for (const dep of manifest[k].dynamicImports ?? []) stack.push(dep);
  }
  return [...seen];
}

const ENTRY = "index.html";
const NEXT = "src/app/main.tsx";
const initialKeys = new Set([...reach(ENTRY, { dynamic: false }), ...reach(NEXT, { dynamic: false })]);
const totalKeys = new Set([...initialKeys, ...reach(NEXT, { dynamic: true })]);
const js = (keys) => [...keys].map((k) => manifest[k].file).filter((f) => f.endsWith(".js"));
const sum = (files) => files.reduce((n, f) => n + gzipKb(f), 0);

const initialKb = sum(js(initialKeys));
const totalKb = sum(js(totalKeys));
// Fonts: every woff2 the /next stylesheets reference (Vite content-hashes
// assets, so a file identical to one the legacy app ships is served once).
const cssFiles = [...totalKeys].flatMap((k) => manifest[k].css ?? []);
const fontFiles = [...new Set(cssFiles.flatMap((f) => [...readFileSync(join(DIST, f), "utf8").matchAll(/url\((?:"|')?\/?([^"')]+\.woff2)/g)].map((m) => m[1])))];
const fontsKb = fontFiles.reduce((n, f) => n + (existsSync(join(DIST, f)) ? statSync(join(DIST, f)).size : 0), 0) / 1024;

const rows = [
  ["/next initial JS (gzip)", initialKb, BUDGET.initialKb],
  ["/next total JS (gzip)", totalKb, BUDGET.totalKb],
  ["design-system fonts", fontsKb, BUDGET.fontsKb],
];
let failed = false;
for (const [label, value, budget] of rows) {
  const ok = value <= budget;
  failed ||= !ok;
  console.log(`${ok ? "✅" : "❌"} ${label}: ${value.toFixed(1)} KB / ${budget} KB`);
}
console.log(`   initial chunks: ${js(initialKeys).join(", ")}`);
console.log(`   fonts: ${fontFiles.join(", ") || "none"}`);
if (failed) process.exit(1);
