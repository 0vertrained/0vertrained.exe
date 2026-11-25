// @vitest-environment jsdom
// Today's check-in: the only place the four check-in rows are entered.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { MorningCheckin } from "../MorningCheckin";

afterEach(cleanup);

const mount = (body, updateToday = vi.fn()) => {
  render(<ThemeProvider><MorningCheckin body={body} updateToday={updateToday} /></ThemeProvider>);
  return updateToday;
};

describe("MorningCheckin", () => {
  it("shows the four rows until answered and writes taps to the body fields", () => {
    const updateToday = mount({});
    for (const row of ["slept", "sore", "stress", "energy"]) expect(screen.getByRole("group", { name: row })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "well" }));
    expect(updateToday).toHaveBeenCalledWith("body.sleepQuality", "9");
    expect(screen.getByText("0/4")).toBeTruthy();
  });

  it("marks the selected tap for assistive tech", () => {
    mount({ soreness: "5" });
    const sore = screen.getByRole("group", { name: "sore" });
    const some = [...sore.querySelectorAll("button")].find((b) => b.textContent === "some");
    expect(some.getAttribute("aria-pressed")).toBe("true");
  });

  it("folds to one line once complete and reopens on Edit", () => {
    mount({ sleepQuality: "6", soreness: "2", stress: "2", energy: "6" });
    expect(screen.getByText("slept fine · sore no · stress low · energy ok")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "slept" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit check-in" }));
    expect(screen.getByRole("group", { name: "slept" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("group", { name: "slept" })).toBeNull();
  });

  it("renders nothing without a write path", () => {
    const { container } = render(<ThemeProvider><MorningCheckin body={{}} /></ThemeProvider>);
    expect(container.innerHTML).toBe("");
  });
});
