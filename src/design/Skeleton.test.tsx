import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("is a busy block named Loading, full width and 48px by default", () => {
    render(<Skeleton />);
    const block = screen.getByRole("status", { name: "Loading" });
    expect(block.getAttribute("aria-busy")).toBe("true");
    expect(block.style.width).toBe("100%");
    expect(block.style.height).toBe("48px");
    expect(block.style.borderRadius).toBe("");
  });

  it("takes width, height and radius", () => {
    render(<Skeleton width={96} height={32} radius={4} />);
    const block = screen.getByRole("status", { name: "Loading" });
    expect(block.style.width).toBe("96px");
    expect(block.style.height).toBe("32px");
    expect(block.style.borderRadius).toBe("4px");
  });

  it("renders a busy stack of lines, the last one short", () => {
    render(<Skeleton lines={4} />);
    const stack = screen.getByRole("status", { name: "Loading" });
    expect(stack.getAttribute("aria-busy")).toBe("true");
    const widths = Array.from(stack.children).map((c) => (c as HTMLElement).style.width);
    expect(widths).toEqual(["100%", "88%", "76%", "60%"]);
  });

  it("has no axe violations for blocks and lines", async () => {
    const { container } = render(
      <div>
        <Skeleton width={96} height={32} radius={4} />
        <Skeleton lines={3} />
        <Skeleton height={48} radius={8} />
      </div>,
    );
    expect(screen.getAllByRole("status", { name: "Loading" })).toHaveLength(3);
    await expectNoA11yViolations(container);
  });
});
