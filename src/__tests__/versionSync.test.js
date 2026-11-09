// @vitest-environment node
// Version single-sourcing enforcement. package.json is the only
// source of truth; appMeta.js consumes it via the __APP_VERSION__ define and
// public/sw.js is stamped by scripts/sync-version.mjs. If this test fails
// after a version bump, run: npm run sync:version
// (node environment: file reads need file:// import.meta.url, and nothing
// here touches the DOM.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../appMeta";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("version single-sourcing", () => {
  it("appMeta.APP_VERSION derives from package.json", () => {
    expect(APP_VERSION).toBe(`V${pkg.version}`);
  });

  it("sw.js cache name is stamped with the package.json version", () => {
    expect(sw).toContain(`const CACHE_NAME = "ovt-shell-v${pkg.version}";`);
  });

  it("package.json version looks like semver", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
