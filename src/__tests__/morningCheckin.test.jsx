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
    for (const row of ["Slept", "Sore", "Stress", "Energy"]) expect(screen.getByRole("radiogroup", { name: row })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "well" }));
    expect(updateToday).toHaveBeenCalledWith("body.sleepQuality", "9");
    expect(screen.getByText("Before you see the score")).toBeTruthy();
  });

  it("marks the selected answer for assistive tech", () => {
    mount({ soreness: "5" });
    const sore = screen.getByRole("radiogroup", { name: "Sore" });
    const some = [...sore.querySelectorAll("button")].find((b) => b.textContent === "some");
    expect(some.getAttribute("role")).toBe("radio");
    expect(some.getAttribute("aria-checked")).toBe("true");
    expect(sore.querySelectorAll('[aria-checked="true"]')).toHaveLength(1);
  });

  it("folds to one line once complete and reopens on Edit", () => {
    mount({ sleepQuality: "6", soreness: "2", stress: "2", energy: "6" });
    expect(screen.getByText("Slept fine · sore no · stress low · energy ok")).toBeTruthy();
    // The folded rows stay mounted, out of reach of the keyboard and screen readers.
    expect(screen.queryByRole("radiogroup", { name: "Slept" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit check-in" }));
    expect(screen.getByRole("radiogroup", { name: "Slept" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("radiogroup", { name: "Slept" })).toBeNull();
  });

  it("renders nothing without a write path", () => {
    const { container } = render(<ThemeProvider><MorningCheckin body={{}} /></ThemeProvider>);
    expect(container.innerHTML).toBe("");
  });
});
