import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { WeekStrip, type WeekStripProps } from "./WeekStrip";

const days: WeekStripProps["days"] = [
  { label: "M", name: "Monday", state: "kept", xp: 130 },
  { label: "T", name: "Tuesday", state: "rest", xp: 30 },
  { label: "W", name: "Wednesday", state: "protected" },
  { label: "T", name: "Thursday", state: "missed" },
  { label: "F", name: "Friday", state: "open", today: true },
  { label: "S", name: "Saturday", state: "upcoming" },
  { label: "S", state: "upcoming" },
];

describe("WeekStrip", () => {
  it("labels each day by state, marks today and reports taps", async () => {
    const user = userEvent.setup();
    const onDay = vi.fn();
    render(<WeekStrip days={days} onDay={onDay} />);
    const list = screen.getByRole("list", { name: "This week" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Monday: kept, 130 XP" }).dataset.state).toBe("kept");
    expect(screen.getByRole("button", { name: "Tuesday: rest day, 30 XP" }).dataset.state).toBe("rest");
    expect(screen.getByRole("button", { name: "Wednesday: protected by a shield" }).dataset.state).toBe("protected");
    expect(screen.getByRole("button", { name: "Thursday: nothing logged" }).dataset.state).toBe("missed");
    expect(screen.getByRole("button", { name: "Saturday: upcoming" }).dataset.state).toBe("upcoming");
    expect(screen.getByRole("button", { name: "S: upcoming" })).toBeTruthy();

    const today = screen.getByRole("button", { name: "Friday, today: open" });
    expect(today.dataset.today).toBe("true");
    expect(today.dataset.state).toBe("open");
    expect(screen.getByRole("button", { name: "Monday: kept, 130 XP" }).dataset.today).toBeUndefined();

    await user.click(today);
    expect(onDay).toHaveBeenCalledWith(4, days[4]);
  });

  it("renders the weekly quest row with a thin objective bar", async () => {
    const { container } = render(<WeekStrip days={days} weekly={{ progress: "3/4 kept", xp: 100, value: 0.75 }} />);
    expect(screen.getByText("Weekly quest")).toBeTruthy();
    expect(screen.getByText("3/4 kept · +100 XP")).toBeTruthy();
    const bar = screen.getByRole("progressbar", { name: "Weekly quest progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("75");
    expect(bar.dataset.kind).toBe("objective");
    await expectNoA11yViolations(container);
  });

  it("omits the weekly row and the XP suffix when absent", () => {
    render(<WeekStrip days={days} weekly={{ label: "Streak week", progress: "2/4", value: 0.5 }} />);
    expect(screen.getByText("Streak week")).toBeTruthy();
    expect(screen.getByText("2/4")).toBeTruthy();
    expect(screen.queryByRole("progressbar", { name: "XP" })).toBeNull();
  });
});
