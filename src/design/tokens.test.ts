// Two guards on the palette: tokens.css must be the compiled form of
// tokens.json, and every text token must pass WCAG 2 contrast on the surfaces
// its usage note puts it on, in both themes. The pairs mirror the design
// system's Colour section; a palette edit that breaks one fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script shared with `npm run gen:tokens`
import { compileTokens } from "../../scripts/gen-tokens.mjs";
import tokens from "./tokens.json";

const here = (p: string) => new URL(p, import.meta.url);

type Theme = "dark" | "light";
type ColorToken = { name: string; value: string | Record<string, string> };

const color = (name: string, theme: Theme): string => {
  const token = (tokens.color.tokens as ColorToken[]).find((t) => t.name === name);
  if (!token) throw new Error(`no token ${name}`);
  const v = typeof token.value === "string" ? token.value : (token.value[theme] ?? token.value["dark"]);
  if (!v) throw new Error(`no ${theme} value for ${name}`);
  return v.startsWith("{") ? color(v.slice(1, -1), theme) : v;
};

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

export function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const TEXT = ["ink", "ink-2", "ink-3", "chalk", "brass", "danger", "tier-full", "tier-reduced", "tier-recover", "tier-rest", "rank-e", "rank-d", "rank-c"];
const SURFACES = ["surface-0", "surface-1", "surface-2"];
/** On surface-3 the documented exceptions: ink-3 only at 24px+, brass as a mark, the copper rank letter 4.3 in paper. */
const SURFACE_3_FLOOR: Record<string, number> = { "ink-3": 4, brass: 4, "rank-c": 4 };

describe("tokens", () => {
  it("tokens.css is the compiled form of tokens.json", () => {
    expect(readFileSync(here("./tokens.css"), "utf8")).toBe(compileTokens(tokens));
  });

  for (const theme of ["dark", "light"] as Theme[]) {
    describe(`${theme} theme contrast`, () => {
      it.each(TEXT.flatMap((t) => SURFACES.map((s) => [t, s])))("%s on %s is at least 4.5:1", (t, s) => {
        expect(contrast(color(t as string, theme), color(s as string, theme))).toBeGreaterThanOrEqual(4.5);
      });
      it.each(TEXT)("%s on surface-3 meets its floor", (t) => {
        expect(contrast(color(t, theme), color("surface-3", theme))).toBeGreaterThanOrEqual(SURFACE_3_FLOOR[t] ?? 4.5);
      });
      it("line-control holds 3:1 on every surface", () => {
        for (const s of [...SURFACES, "surface-3"]) expect(contrast(color("line-control", theme), color(s, theme))).toBeGreaterThanOrEqual(3);
      });
      it("labels on fills pass 4.5:1", () => {
        expect(contrast(color("on-chalk", theme), color("chalk", theme))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color("on-brass", theme), color("brass-fill", theme))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(color("on-danger", theme), color("danger-fill", theme))).toBeGreaterThanOrEqual(4.5);
        for (const r of ["rank-b", "rank-a", "rank-s"]) expect(contrast(color("ink-on-light", theme), color(r, theme))).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it("the light theme's filled rank tiles keep a 3:1 edge on cards", () => {
    expect(contrast(color("rank-edge", "light"), color("surface-1", "light"))).toBeGreaterThanOrEqual(3);
  });
});
