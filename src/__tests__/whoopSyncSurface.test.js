// Whoop sync surface: getWhoopSyncCounts keeps a stable shape, and the
// server's counts and sync endpoints stay safe (a clamped backfill window,
// never selecting the raw payload). The display-only Whoop cards these tests
// once rendered were retired; Recovery lists Whoop's numbers under Wearables.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getWhoopSyncCounts } from "../whoop";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const read = (p) => readFileSync(resolve(repoRoot, p), "utf8");

describe("getWhoopSyncCounts", () => {
  test("returns the expected stable shape", async () => {
    const counts = await getWhoopSyncCounts();
    expect(counts).toEqual(
      expect.objectContaining({
        cycle: expect.any(Number),
        sleep: expect.any(Number),
        recovery: expect.any(Number),
        workout: expect.any(Number),
      })
    );
    expect(counts).toHaveProperty("lastSynced");
    expect(counts).toHaveProperty("latestDate");
  });
});

// Static server assertions
describe("V2.9.2 server surface", () => {
  const fnSrc = read("netlify/functions/whoop-auth.js");

  test("declares the /api/whoop/counts endpoint", () => {
    expect(fnSrc).toContain("/api/whoop/counts");
    expect(fnSrc).toMatch(/function handleCounts/);
  });

  test("sync accepts an optional ?days= backfill window, clamped server-side", () => {
    expect(fnSrc).toMatch(/searchParams\.get\(["']days["']\)/);
    expect(fnSrc).toMatch(/MAX_SYNC_DAYS/);
  });

  test("counts endpoint never selects the raw payload column", () => {
    const countsFn = fnSrc.slice(fnSrc.indexOf("async function handleCounts"));
    expect(countsFn).toContain("select=date,data_type,synced_at");
    expect(countsFn).not.toMatch(/select=[^"'`]*payload/);
  });
});
