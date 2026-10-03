import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("draws one path through every point and a dot on the last", () => {
    const { container } = render(<Sparkline data={[36, 38, 39, 41, 43]} />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("viewBox")).toBe("0 0 120 28");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    const d = svg.querySelector("path")?.getAttribute("d") ?? "";
    expect(d.startsWith("M3.0 25.0")).toBe(true);
    expect(d.match(/L/g)).toHaveLength(4);
    expect(d.endsWith("L117.0 3.0")).toBe(true);
    const dot = svg.querySelector("circle");
    expect(dot?.getAttribute("cx")).toBe("117");
    expect(dot?.getAttribute("cy")).toBe("3");
    expect(dot?.getAttribute("r")).toBe("2.5");
  });

  it("keeps a flat series on one line instead of dividing by zero", () => {
    const { container } = render(<Sparkline data={[31, 31, 31]} width={60} height={20} />);
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    expect(d).toBe("M3.0 17.0 L30.0 17.0 L57.0 17.0");
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 60 20");
  });

  it("renders an empty hidden svg for fewer than two points", () => {
    const { container } = render(<Sparkline data={[42]} />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.children).toHaveLength(0);
  });

  it("has no axe violations, brass or not", async () => {
    const { container } = render(
      <div>
        <Sparkline data={[1, 2, 3]} />
        <Sparkline data={[3, 2, 1]} brass />
        <Sparkline data={[]} />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
