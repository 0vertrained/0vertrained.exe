import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// V13.5 · package.json is the single source of truth for the app version.
// appMeta.js consumes it via this define; public/sw.js is stamped from it by
// scripts/sync-version.mjs (prebuild) and drift fails versionSync.test.js.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// The service worker precaches every built chunk (not only those index.html
// references) so lazy routes, the legacy app included, open offline after one
// visit. public/sw.js reads this list at install.
function swAssetsPlugin() {
  return {
    name: "ovt-sw-assets",
    generateBundle(_options, bundle) {
      const urls = Object.keys(bundle)
        .filter((name) => /\.(js|css)$/.test(name))
        .map((name) => `/${name}`)
        .sort();
      this.emitFile({ type: "asset", fileName: "sw-assets.json", source: JSON.stringify(urls) });
    },
  };
}

export default defineConfig({
  plugins: [react(), swAssetsPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: "dist",
    // scripts/check-budgets.mjs reads the manifest to size the /next entry.
    manifest: true,
  },
});
