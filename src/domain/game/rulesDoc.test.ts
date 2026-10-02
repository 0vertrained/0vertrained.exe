import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderRulesMarkdown, RULES_END, RULES_START, spliceRules } from "./rulesDoc";

describe("README game rules", () => {
  it("match the config (run `npm run gen:rules` after changing a rule)", () => {
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
    expect(spliceRules(readme, renderRulesMarkdown())).toBe(readme);
  });

  it("render every rank, achievement and the level checkpoints", () => {
    const md = renderRulesMarkdown();
    for (const rank of ["| E |", "| D |", "| C |", "| B |", "| A |", "| S |"]) expect(md).toContain(rank);
    expect(md).toContain("| 50 | 73,500 |");
    expect(md).toContain("Record Breaker III");
    expect(md).toContain("3 days → 120");
  });

  it("splices between the markers and refuses a README without them", () => {
    expect(spliceRules(`a\n${RULES_START}\nold\n${RULES_END}\nz`, "new")).toBe(`a\n${RULES_START}\nnew\n${RULES_END}\nz`);
    expect(() => spliceRules("no markers", "x")).toThrow(/markers/);
    expect(() => spliceRules(`${RULES_END}\n${RULES_START}`, "x")).toThrow(/markers/);
  });
});
