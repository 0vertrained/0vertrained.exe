import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// V13.5 · package.json is the single source of truth for the app version.
// appMeta.js consumes it via this define; public/sw.js is stamped from it by
// scripts/sync-version.mjs (prebuild) and drift fails versionSync.test.js.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist",
  },
});
