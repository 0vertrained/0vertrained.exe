import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { RestTimerBar } from "./RestTimerBar";

describe("RestTimerBar", () => {
  it("is a Rest timer region with the countdown, ±30 s, Skip and a thin timer bar", async () => {
    const user = userEvent.setup();
    const onMinus = vi.fn();
    const onPlus = vi.fn();
    const onSkip = vi.fn();
    const { container } = render(<RestTimerBar total={90} remaining={42} onMinus={onMinus} onPlus={onPlus} onSkip={onSkip} />);
    const region = screen.getByRole("region", { name: "Rest timer" });
    expect(within(region).getByText("Rest")).toBeTruthy();
    const timer = within(region).getByRole("timer");
    expect(timer.textContent).toBe("00:42");
    expect(timer.getAttribute("aria-live")).toBe("off");

    await user.click(screen.getByRole("button", { name: "Thirty seconds less" }));
    await user.click(screen.getByRole("button", { name: "Thirty seconds more" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(onMinus).toHaveBeenCalledTimes(1);
    expect(onPlus).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Thirty seconds less" }).textContent).toBe("−30 s");
    expect(screen.getByRole("button", { name: "Thirty seconds more" }).textContent).toBe("+30 s");

    const bar = screen.getByRole("progressbar", { name: "Rest remaining" });
    expect(bar.getAttribute("aria-valuenow")).toBe("47");
    expect(bar.dataset.kind).toBe("timer");
    await expectNoA11yViolations(container);
  });

  it("stays at 00:00 and an empty bar once the rest is over", () => {
    render(<RestTimerBar total={90} remaining={0} />);
    expect(screen.getByRole("timer").textContent).toBe("00:00");
    expect(screen.getByRole("progressbar", { name: "Rest remaining" }).getAttribute("aria-valuenow")).toBe("0");
  });

  it("does not divide by a zero total", () => {
    render(<RestTimerBar total={0} remaining={0} />);
    expect(screen.getByRole("progressbar", { name: "Rest remaining" }).getAttribute("aria-valuenow")).toBe("0");
  });
});
