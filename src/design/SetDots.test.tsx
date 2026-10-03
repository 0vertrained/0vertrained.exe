import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { SetDots } from "./SetDots";

describe("SetDots", () => {
  it("lets done, trial-done and pain dots edit and keeps the others inert", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { container } = render(
      <SetDots sets={["done", { state: "trial", done: true }, "pain", "current", "planned", "extra", { state: "trial" }]} onEdit={onEdit} />,
    );
    const list = screen.getByRole("list", { name: "Sets" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);

    const done = screen.getByRole("button", { name: "Set 1, done. Edit" });
    const trialDone = screen.getByRole("button", { name: "Set 2, rank trial. Edit" });
    const pain = screen.getByRole("button", { name: "Set 3, pain flagged. Edit" });
    for (const dot of [done, trialDone, pain]) {
      expect(dot.getAttribute("aria-disabled")).toBeNull();
      expect(dot.tabIndex).toBe(0);
    }
    expect(done.dataset.state).toBe("done");
    expect(trialDone.dataset.state).toBe("trial");
    expect(trialDone.dataset.done).toBe("true");
    await user.click(done);
    await user.click(trialDone);
    await user.click(pain);
    expect(onEdit.mock.calls).toEqual([[0], [1], [2]]);

    const current = screen.getByRole("button", { name: "Set 4, current" });
    expect(current.getAttribute("aria-current")).toBe("step");
    for (const dot of [
      current,
      screen.getByRole("button", { name: "Set 5, planned" }),
      screen.getByRole("button", { name: "Set 6, extra, no XP" }),
      screen.getByRole("button", { name: "Set 7, rank trial" }),
    ]) {
      expect(dot.getAttribute("aria-disabled")).toBe("true");
      expect(dot.tabIndex).toBe(-1);
      await user.click(dot);
    }
    expect(onEdit).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Set 7, rank trial" }).dataset.done).toBeUndefined();
    await expectNoA11yViolations(container);
  });

  it("takes a custom list label", () => {
    render(<SetDots sets={["current"]} label="Warm-up sets" />);
    expect(screen.getByRole("list", { name: "Warm-up sets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set 1, current" }).getAttribute("aria-current")).toBe("step");
  });
});
