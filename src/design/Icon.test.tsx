import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { ICON_NAMES, Icon } from "./Icon";

describe("Icon", () => {
  it("is decorative without a label: aria-hidden, no role", () => {
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("role")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("becomes an image named by its label", () => {
    render(<Icon name="close" label="Close" />);
    const img = screen.getByRole("img", { name: "Close" });
    expect(img.getAttribute("aria-hidden")).toBeNull();
  });

  it("sizes to the given px and draws in currentColor", () => {
    const { container } = render(<Icon name="flame" size={16} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it("rotates the chevron with a transform", () => {
    const { container } = render(<Icon name="chevron" rotate={90} />);
    expect((container.querySelector("svg") as SVGElement).style.transform).toBe("rotate(90deg)");
    const { container: plain } = render(<Icon name="chevron" />);
    expect((plain.querySelector("svg") as SVGElement).getAttribute("style")).toBeNull();
  });

  it("ships the 19-glyph set, each with at least one path", () => {
    expect(ICON_NAMES).toHaveLength(19);
    const { container } = render(<>{ICON_NAMES.map((n) => <Icon key={n} name={n} />)}</>);
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(19);
    svgs.forEach((svg) => expect(svg.querySelectorAll("path").length).toBeGreaterThan(0));
  });

  it("has no axe violations decorative or labelled", async () => {
    const { container } = render(
      <div>
        <Icon name="quest" />
        <Icon name="lock" label="Locked" />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
