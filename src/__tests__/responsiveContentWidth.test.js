import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");

const CONTRACT = "var(--ovt-content-width)";

describe("responsive content-width contract", () => {
  test("defines conservative mobile, tablet, and desktop widths in one CSS contract", () => {
    const css = read("src/index.css");

    expect(css).toContain(":root { --ovt-content-width: 480px; }");
    expect(css).toMatch(/@media \(min-width: 481px\) and \(max-width: 767px\)\s*\{\s*:root \{ --ovt-content-width: 100%;/);
    expect(css).toContain("@media (min-width: 768px)");
    expect(css).toContain(":root { --ovt-content-width: 720px; }");
    expect(css).toMatch(/@media \(min-width: 768px\) and \(max-width: 1023px\)\s*\{\s*:root \{ --ovt-shell-width: 100%;/);
  });

  test("V15.0 · defines the broadsheet shell tier without touching the content-width contract", () => {
    const css = readFileSync(resolve(root, "src/index.css"), "utf8");
    // The shell width defaults to the content width…
    expect(css).toContain("--ovt-shell-width: var(--ovt-content-width)");
    // …and widens for the full three-column broadsheet at this tier.
    // The :root block went multi-line when the rail tokens landed;
    // substring pins replace the one-line regex.
    expect(css).toContain("@media (min-width: 1440px)");
    expect(css).toContain("--ovt-shell-width: min(1856px, calc(100vw - 48px))");
    // Fixed surfaces keep the reading-column contract: content-width has NO 1440 override.
    expect(css).not.toMatch(/1440px[^}]*--ovt-content-width/s);
    const ledger = readFileSync(resolve(root, "src/ledger.css"), "utf8");
    // A tab screen consumes the shell var (with the content var as fallback)…
    expect(ledger).toMatch(/\.tab-screen \{[^}]*max-width: var\(--ovt-shell-width, var\(--ovt-content-width\)\)/);
    // …while the sheet and compact tab bar default to the reading width.
    expect(ledger).toMatch(/\.sheet \{[^}]*max-width: var\(--ovt-content-width\)/);
    expect(ledger).toMatch(/\.tabbar \{[^}]*max-width: var\(--ovt-content-width\)/);
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain(":root { --ovt-content-width: 760px; }");
    expect(css).not.toContain("max-width: 960px !important");
    expect(css).not.toContain(".ovt-app-shell  { max-width");
  });

  test("shares the contract between shell, bottom dock, and quick-log sheet", () => {
    const css = read("src/ledger.css");
    expect(css).toMatch(/\.shell \{[^}]*max-width: var\(--ovt-content-width\)/);
    expect(css).toMatch(/\.tabbar \{[^}]*max-width: var\(--ovt-content-width\)/);
    expect(css).toMatch(/\.sheet \{[^}]*max-width: var\(--ovt-content-width\)/);
    expect(css).not.toMatch(/\.(?:shell|tabbar|sheet) \{[^}]*max-width: 480px/);
  });

  test("keeps centered page-relative overlays and fixed action bars aligned to the shell", () => {
    for (const file of [
      "src/SettingsScreen.jsx",
      "src/App.jsx",
      "src/Coach.jsx",
      "src/Tutorial.jsx",
    ]) {
      expect(read(file)).toContain(CONTRACT);
    }
    // The Box Score is a full-screen flow whose column is the shell's.
    expect(read("src/SessionComplete.jsx")).toContain('<div className="shell">');
    expect(read("src/ledger.css")).toMatch(/\.shell \{[^}]*max-width: var\(--ovt-content-width\)/);
  });

  test("does not narrow intentionally full-viewport active-session dialogs", () => {
    for (const file of ["src/CardioSession.jsx", "src/SessionMode.jsx"]) {
      const source = read(file);
      expect(source).toContain("<Flow ");
      expect(source).not.toContain(CONTRACT);
    }
    expect(read("src/ledger.css")).toMatch(/\.flow-screen \{ position: fixed; inset: 0;/);
  });
});
