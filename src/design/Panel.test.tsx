import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Panel } from "./Panel";

describe("Panel", () => {
  it("is a section with its children and no heading by default", () => {
    const { container } = render(<Panel><p>Changes apply from tomorrow.</p></Panel>);
    expect(container.firstElementChild?.tagName).toBe("SECTION");
    expect(screen.getByText("Changes apply from tomorrow.")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("sets a level-2 heading from title", () => {
    render(<Panel title="Program">body</Panel>);
    expect(screen.getByRole("heading", { level: 2, name: "Program" })).toBeTruthy();
  });

  it("renders as another element and passes style through", () => {
    const { container } = render(<Panel as="div" sunken style={{ maxWidth: 390 }}>inner</Panel>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("DIV");
    expect(el.style.maxWidth).toBe("390px");
    expect(el.textContent).toBe("inner");
  });

  it("has no axe violations titled, sunken and nested", async () => {
    const { container } = render(
      <Panel title="Program">
        <p>Changes apply from tomorrow.</p>
        <Panel as="div" sunken>Preview</Panel>
      </Panel>,
    );
    await expectNoA11yViolations(container);
  });
});
