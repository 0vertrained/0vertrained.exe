import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../test/axe";
import { OnboardingFlow } from "./OnboardingFlow";

describe("OnboardingFlow", () => {
  it("walks three sheets and hands back the answers with bodyweight in kg", async () => {
    const onComplete = vi.fn();
    const { container } = render(<OnboardingFlow onComplete={onComplete} onCancel={() => {}} />);
    expect(screen.getByRole("dialog", { name: "What are you training for?" })).toBeInTheDocument();
    await expectNoA11yViolations(container);
    await userEvent.click(screen.getByRole("radio", { name: "Strength" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Days" })).getByRole("radio", { name: "4" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("dialog", { name: "What do you train with?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Dumbbells" }));
    await userEvent.click(screen.getByRole("radio", { name: "lb · mi" }));
    await userEvent.type(screen.getByRole("textbox", { name: /Bodyweight/ }), "176.4");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("dialog", { name: "Your first week" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Program preview" })).getAllByRole("listitem")).toHaveLength(7);
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onComplete).toHaveBeenCalledWith({ goal: "strength", daysPerWeek: 4, equipment: "dumbbells", experience: "beginner", units: "imperial", bodyweightKg: 80 });
  });

  it("closing the first sheet cancels; closing a later one goes back", async () => {
    const onCancel = vi.fn();
    render(<OnboardingFlow onComplete={() => {}} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog", { name: "What are you training for?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
