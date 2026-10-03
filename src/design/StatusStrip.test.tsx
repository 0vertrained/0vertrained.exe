import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { StatusStrip } from "./StatusStrip";

describe("StatusStrip", () => {
  it("shows rank, level, the XP bar and the streak; synced is a quiet status", async () => {
    const { container } = render(<StatusStrip rank="c" level={17} xp={{ value: 1140, max: 1500 }} streak={{ days: 23, shields: 1, shieldsTotal: 2 }} />);
    expect(screen.getByRole("img", { name: "Rank C" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Lv 17")).toBeTruthy();
    const bar = screen.getByRole("progressbar", { name: "XP 1140 of 1500" });
    expect(bar.getAttribute("aria-valuenow")).toBe("76");
    expect(bar.dataset.kind).toBe("xp");
    expect(screen.getByLabelText("Streak 23 days, 1 of 2 shields").textContent).toBe("23");
    const sync = screen.getByRole("status", { name: "Synced" });
    expect(sync.getAttribute("aria-live")).toBe("polite");
    expect(sync.textContent).toBe("");
    expect(screen.queryByText("Guest")).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("says Saving while saving", () => {
    render(<StatusStrip rank="b" level={22} xp={{ value: 300, max: 1800 }} sync={{ state: "saving" }} />);
    expect(screen.getByRole("status", { name: "Saving" }).textContent).toBe("Saving");
  });

  it("shows the queued count offline and the Guest chip in guest mode", () => {
    render(<StatusStrip rank="e" level={3} xp={{ value: 40, max: 300 }} sync={{ state: "offline", count: 3 }} guest />);
    expect(screen.getByRole("status").textContent).toBe("3");
    expect(screen.getByText("Guest")).toBeTruthy();
  });

  it("falls back to the word Offline without a count and says Merged after a conflict", () => {
    const { rerender } = render(<StatusStrip rank="s" level={48} xp={{ value: 2100, max: 4000 }} sync={{ state: "offline" }} />);
    expect(screen.getByRole("status").textContent).toBe("Offline");
    rerender(<StatusStrip rank="s" level={48} xp={{ value: 2100, max: 4000 }} sync={{ state: "conflict" }} />);
    expect(screen.getByRole("status").textContent).toBe("Merged");
  });

  it("makes the rank tile a button that opens Stats when `onRank` is given", async () => {
    const user = userEvent.setup();
    const onRank = vi.fn();
    const { container } = render(<StatusStrip rank="c" level={17} xp={{ value: 0, max: 0 }} onRank={onRank} guest />);
    await user.click(screen.getByRole("button", { name: "Rank C. Open Stats" }));
    expect(onRank).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("progressbar", { name: "XP 0 of 0" }).getAttribute("aria-valuenow")).toBe("0");
    await expectNoA11yViolations(container);
  });
});
