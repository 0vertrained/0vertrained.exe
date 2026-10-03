import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { TierBadge } from "./TierBadge";

const TIERS = ["full", "reduced", "recover", "rest"] as const;
const LABEL = { full: "Full", reduced: "Reduced", recover: "Recover", rest: "Rest" } as const;

describe("TierBadge", () => {
  it.each(TIERS)("shows the word for %s and labels it Tier: …", (tier) => {
    render(<TierBadge tier={tier} />);
    const badge = screen.getByText(LABEL[tier]);
    expect(badge.getAttribute("data-tier")).toBe(tier);
    expect(badge.getAttribute("aria-label")).toBe(`Tier: ${LABEL[tier]}`);
  });

  it("normalises the engine's uppercase tier", () => {
    render(<TierBadge tier="REDUCED" size="lg" />);
    const badge = screen.getByText("Reduced");
    expect(badge.getAttribute("data-tier")).toBe("reduced");
    expect(badge.getAttribute("aria-label")).toBe("Tier: Reduced");
  });

  it("has no axe violations at 24 and 32px", async () => {
    const { container } = render(
      <div>
        {TIERS.map((t) => <TierBadge key={t} tier={t} />)}
        {TIERS.map((t) => <TierBadge key={`${t}-lg`} tier={t} size="lg" />)}
      </div>,
    );
    expect(screen.getAllByText(/^(Full|Reduced|Recover|Rest)$/)).toHaveLength(8);
    await expectNoA11yViolations(container);
  });
});
