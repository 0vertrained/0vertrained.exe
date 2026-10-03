import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { RankBadge } from "./RankBadge";

describe("RankBadge", () => {
  it("is an image named Rank B that also shows the letter", () => {
    render(<RankBadge rank="b" />);
    const badge = screen.getByRole("img", { name: "Rank B" });
    expect(badge.textContent).toBe("B");
    expect(badge.getAttribute("data-rank")).toBe("b");
  });

  it("accepts the engine's uppercase rank", () => {
    render(<RankBadge rank="S" size="xl" />);
    const badge = screen.getByRole("img", { name: "Rank S" });
    expect(badge.textContent).toBe("S");
    expect(badge.getAttribute("data-rank")).toBe("s");
  });

  it("defaults to the 24px tile and never hides the letter", () => {
    render(<RankBadge rank="e" />);
    expect(screen.getByRole("img", { name: "Rank E" }).textContent).toBe("E");
  });

  it("has no axe violations across the six ranks and four sizes", async () => {
    const { container } = render(
      <div>
        <RankBadge rank="e" />
        <RankBadge rank="d" size="md" />
        <RankBadge rank="c" size="lg" />
        <RankBadge rank="b" size="xl" />
        <RankBadge rank="a" />
        <RankBadge rank="s" />
      </div>,
    );
    expect(screen.getAllByRole("img")).toHaveLength(6);
    await expectNoA11yViolations(container);
  });
});
