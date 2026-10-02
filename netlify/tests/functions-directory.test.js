import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const DEPLOYABLE_NAME = /^[A-Za-z0-9_-]+\.(?:js|mjs|cjs|ts)$/;

describe("Netlify functions directory", () => {
  it("contains only deployable function filenames", () => {
    const files = readdirSync(join(process.cwd(), "netlify/functions"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => [".js", ".mjs", ".cjs", ".ts"].includes(extname(name)));

    expect(files.every((name) => DEPLOYABLE_NAME.test(name))).toBe(true);
    expect(files.some((name) => /\.(?:test|spec)\./.test(name))).toBe(false);
  });

  // v19.2.1 · A function with neither a route nor a schedule is unreachable:
  // /api/* falls through netlify.toml's SPA rewrite and returns index.html.
  // Helpers (_*.js) are imported, not deployed. account-recovery is routed by
  // a netlify.toml redirect; oura-sync is legacy and has no caller.
  it("every deployable function declares a route or a schedule", () => {
    const routedByRedirect = new Set(["account-recovery.js", "oura-sync.js"]);
    const dir = join(process.cwd(), "netlify/functions");
    const unreachable = readdirSync(dir)
      .filter((name) => [".js", ".mjs", ".cjs", ".ts"].includes(extname(name)))
      .filter((name) => !name.startsWith("_") && !routedByRedirect.has(name))
      .filter((name) => !/export const config\s*=\s*\{[^}]*\b(path|schedule)\s*:/.test(readFileSync(join(dir, name), "utf8")));
    expect(unreachable).toEqual([]);
  });

  it("routes the client-facing sinks the browser calls", () => {
    const dir = join(process.cwd(), "netlify/functions");
    for (const name of ["log-error", "log-event", "push-subscribe"]) {
      expect(readFileSync(join(dir, `${name}.js`), "utf8")).toContain(`export const config = { path: "/api/${name}" };`);
    }
  });
});
