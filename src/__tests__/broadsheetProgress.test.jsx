// @vitest-environment jsdom
// Mounted smoke for the Progress spreads (per the V15.1.1 policy:
// every new broadsheet surface gets a render test, not just source guards).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { ProgressTab } from "../ProgressTab";

function forceMatchMedia(matches) {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query) => ({
    matches, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

describe("broadsheet progress (mounted)", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("renders the home spread and the History master–detail at the tier", () => {
    forceMatchMedia(true);
    const { container } = render(
      <ThemeProvider>
        <ProgressTab data={{}} settings={{}} program={{}} loaded={true} />
      </ThemeProvider>
    );
    expect(container.querySelector('[data-section="ov-verdict"]')).toBeTruthy();
    expect(container.querySelector('[data-section="ov-plates"]')).toBeTruthy();
    expect(container.querySelector('[data-section="ov-trends"]')).toBeTruthy();
    // The wide home sets the review beside the week in numbers.
    expect(screen.getByText("The week in numbers")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(container.querySelector('[data-section="hist-master"]')).toBeTruthy();
    expect(container.querySelector('[data-section="hist-detail-hint"]')).toBeTruthy();
    // A day picked on the calendar opens beside it, not over it.
    fireEvent.click(container.querySelector('.dayc[aria-current="date"]'));
    expect(container.querySelector('[data-section="hist-master"]')).toBeTruthy();
    expect(container.querySelector('[data-section="day-detail"]')).toBeTruthy();
  });
});
