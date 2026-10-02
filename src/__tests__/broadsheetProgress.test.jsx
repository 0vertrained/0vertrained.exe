// @vitest-environment jsdom
// V15.2 · Mounted smoke for the Progress spreads (per the V15.1.1 policy:
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

  it("renders the Overview spread and the History master–detail at the tier", () => {
    forceMatchMedia(true);
    const { container } = render(
      <ThemeProvider>
        <ProgressTab data={{}} settings={{}} program={{}} loaded={true} />
      </ThemeProvider>
    );
    expect(container.querySelector('[data-section="ov-verdict"]')).toBeTruthy();
    expect(container.querySelector('[data-section="ov-plates"]')).toBeTruthy();
    expect(container.querySelector('[data-section="ov-trends"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    expect(container.querySelector('[data-section="hist-master"]')).toBeTruthy();
    expect(container.querySelector('[data-section="hist-detail-hint"]')).toBeTruthy();
  });
});
