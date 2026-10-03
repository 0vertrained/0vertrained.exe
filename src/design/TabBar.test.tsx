import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/axe";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("marks the active tab with aria-current and reports taps", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<TabBar active="quest" onChange={onChange} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const tabs = within(nav).getAllByRole("button");
    expect(tabs.map((t) => t.textContent)).toEqual(["Quest", "Stats", "Profile"]);
    expect(screen.getByRole("button", { name: "Quest" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Stats" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: "Profile" }).getAttribute("aria-current")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stats" }));
    expect(onChange).toHaveBeenCalledWith("stats");
    await expectNoA11yViolations(container);
  });

  it("moves aria-current with `active` and takes custom tabs", () => {
    const { rerender } = render(<TabBar active="stats" />);
    expect(screen.getByRole("button", { name: "Stats" }).getAttribute("aria-current")).toBe("page");
    rerender(<TabBar active="profile" tabs={[{ id: "profile", label: "You", icon: "profile" }, { id: "quest", label: "Today", icon: "quest" }]} />);
    expect(screen.getByRole("button", { name: "You" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-current")).toBeNull();
    expect(screen.queryByRole("button", { name: "Stats" })).toBeNull();
  });
});
