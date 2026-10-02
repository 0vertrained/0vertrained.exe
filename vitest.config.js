import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Keep the __APP_VERSION__ define in step with vite.config.js so tests see
// the same appMeta values the built app ships.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      // v20 domain logic is held to a coverage floor; legacy v19 code is not.
      include: ["src/domain/**/*.ts"],
      exclude: ["src/domain/**/*.test.ts"],
      reporter: ["text-summary", "html"],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
  build: {
    outDir: "dist",
  },
});
