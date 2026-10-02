// @vitest-environment jsdom
// V15.1.1 · Regression: the context strip rendered the calcStreak OBJECT
// ({count, active}) as a React child — React #31, desktop-only, shipped
// because every broadsheet guard was a static source check. This is the
// first test that actually MOUNTS the broadsheet header. If a future edit
// renders a non-primitive in the masthead, this throws before prod does.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { Header, calcStreak } from "../AppHeader";

function forceMatchMedia(matches) {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query) => ({
    matches, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

const todayKey = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

describe("broadsheet header (mounted)", () => {
  // RTL auto-cleanup only registers when vitest exposes globals; this project
  // doesn't, so without this the first render leaks into the second test.
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("renders the full masthead + context strip at the tier without throwing", () => {
    forceMatchMedia(true); // both DESKTOP_QUERY and BROADSHEET_QUERY match
    const allData = { [todayKey]: { nutrition: { calories: "500" } } };
    render(
      <ThemeProvider>
        <Header
          saving={false} demoMode={false} isOnline={true} pendingSaves={{}}
          allData={allData} currentTab="Today" tabsOrder={["Today", "Fuel", "Recovery", "Progress"]}
          onTabChange={() => {}} onQuickAction={() => {}} onOpenProfile={() => {}}
          program={{ Saturday: { name: "Upper A · Push" } }} todayName="Saturday" logDate={null}
        />
      </ThemeProvider>
    );
    // The streak renders as a NUMBER inside the sentence, not an object.
    expect(screen.getByText(`Streak ${calcStreak(allData).count} days`)).toBeTruthy();
    expect(screen.getByText("Logging: Today")).toBeTruthy();
    expect(screen.getByText("Upper A · Push")).toBeTruthy();
    expect(screen.getByText("+ Log")).toBeTruthy();
  });

  it("mobile header renders without the strip and without throwing", () => {
    forceMatchMedia(false);
    render(
      <ThemeProvider>
        <Header saving={false} demoMode={false} isOnline={true} pendingSaves={{}} allData={{}} currentTab="Today" onOpenProfile={() => {}} />
      </ThemeProvider>
    );
    expect(screen.queryByText(/Streak/)).toBeNull();
  });
});
