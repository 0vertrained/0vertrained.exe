import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
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
});
