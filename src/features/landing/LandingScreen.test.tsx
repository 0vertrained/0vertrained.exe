import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../test/axe";
import { LandingScreen } from "./LandingScreen";

describe("LandingScreen", () => {
  it("offers the demo as the one primary action and keeps sign-in for later", async () => {
    const onDemo = vi.fn();
    const onFresh = vi.fn();
    const { container } = render(<LandingScreen onDemo={onDemo} onFresh={onFresh} />);
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    await userEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    expect(onDemo).toHaveBeenCalledTimes(1);
    expect(onFresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    await expectNoA11yViolations(container);
  });

  it("runs the real tier table in the playground", async () => {
    render(<LandingScreen onDemo={() => {}} onFresh={() => {}} />);
    expect(screen.getByRole("img", { name: "Tier: Full" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radiogroup", { name: "Slept" }).querySelector('[role="radio"]') as HTMLElement);
    await userEvent.click(screen.getByRole("radio", { name: "very" }));
    expect(screen.getByRole("img", { name: "Tier: Reduced" })).toBeInTheDocument();
    expect(screen.getByText(/Slept poorly \+ very sore: one set less per lift\. Same XP\./)).toBeInTheDocument();
  });
});
