// Browser smoke tests against the production build (`vite preview`), on a
// phone (390×844) and a desktop (1280×800) viewport. Guest mode only: no
// secrets, no network beyond the preview server. `npm run build` first.
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const bundled = ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => existsSync(p));
const executablePath = process.env["PW_CHROMIUM_PATH"] ?? (process.env["CI"] ? undefined : bundled);

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  // --host 127.0.0.1: Vite binds `localhost`, which Node resolves to ::1 on
  // GitHub's runners, while the url below polls IPv4. Pin both to the same
  // address or the smoke job times out waiting for a server that is up.
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
  projects: [
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
