// The domain is the pure core: no React, no Supabase, no legacy v19 modules,
// no I/O. It may import only other domain files (and type-only imports from
// them). The clock/randomness bans are enforced by ESLint.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DOMAIN = resolve(process.cwd(), "src/domain");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe("domain purity", () => {
  it("imports nothing outside src/domain", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(DOMAIN)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)) {
        const spec = match[1] ?? "";
        const target = spec.startsWith(".") ? resolve(dirname(file), spec) : null;
        if (!target || relative(DOMAIN, target).startsWith("..")) {
          violations.push(`${relative(DOMAIN, file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
