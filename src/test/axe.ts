// axe-core in jsdom for component tests: `await expectNoA11yViolations(container)`.
// Colour-contrast needs a layout engine, so that rule is off here; the token
// contrast test (src/design/tokens.test.ts) covers it from the palette.
import axe from "axe-core";
import { expect } from "vitest";

const RULES = { "color-contrast": { enabled: false }, region: { enabled: false } };

export async function expectNoA11yViolations(node: Element): Promise<void> {
  const result = await axe.run(node, { rules: RULES, resultTypes: ["violations"] });
  const summary = result.violations.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.html).join("\n  ")}`).join("\n");
  expect(summary, "axe violations").toBe("");
}
