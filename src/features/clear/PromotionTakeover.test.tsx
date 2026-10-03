import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../../test/axe";
import { PROMOTION_DONE_AT_MS, PromotionTakeover } from "./PromotionTakeover";

describe("PromotionTakeover", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the new rank's badge, name and title, with Done at once under reduced motion", async () => {
    const onDone = vi.fn();
    const { container } = render(<PromotionTakeover rank="C" title="Contender" onDone={onDone} reducedMotion />);
    const dialog = screen.getByRole("dialog", { name: "Rank C" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("data-reduced", "true");
    expect(screen.getByRole("img", { name: "Rank C" })).toHaveClass("ot-rank-xl");
    expect(screen.getByRole("heading", { level: 2, name: "Rank C" })).toHaveClass("ot-display-md");
    expect(screen.getByText("Contender")).toHaveClass("ot-heading");
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeVisible();
    expect(document.activeElement).toBe(done);
    expect(container.querySelectorAll("[data-primary]")).toHaveLength(1);
    await userEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(dialog.textContent).not.toMatch(/!/);
    await expectNoA11yViolations(container);
  });

  it("keeps Done present but hidden until the hairline has drawn, then focuses it", () => {
    vi.useFakeTimers();
    const { container } = render(<PromotionTakeover rank="D" title="Initiate" onDone={() => {}} reducedMotion={false} />);
    const dialog = screen.getByRole("dialog", { name: "Rank D" });
    expect(dialog).not.toHaveAttribute("data-reduced");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    const hiddenDone = container.querySelector("button[data-primary]") as HTMLElement;
    expect(hiddenDone).toHaveAttribute("hidden");
    expect(hiddenDone).not.toBeVisible();
    expect(hiddenDone).toHaveTextContent("Done");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Rank D" }));
    act(() => vi.advanceTimersByTime(PROMOTION_DONE_AT_MS - 1));
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeVisible();
    expect(document.activeElement).toBe(done);
    expect(done).not.toHaveAttribute("hidden");
  });

  it("clears its timer on unmount", () => {
    vi.useFakeTimers();
    const set = vi.spyOn(window, "setTimeout");
    const clear = vi.spyOn(window, "clearTimeout");
    const { unmount } = render(<PromotionTakeover rank="B" title="Veteran" onDone={() => {}} reducedMotion={false} />);
    const call = set.mock.calls.findIndex((args) => args[1] === PROMOTION_DONE_AT_MS);
    expect(call).toBeGreaterThanOrEqual(0);
    const id = set.mock.results[call]?.value as number;
    unmount();
    expect(clear.mock.calls.some((args) => args[0] === id)).toBe(true);
  });
});
