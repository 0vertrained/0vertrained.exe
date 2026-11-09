import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { TodayTab } from "../TodayTab";
import { DEFAULT_PROGRAM, defaultDay, getTodayKey, getDayName } from "../constants";
import { DEFAULT_SETTINGS } from "../data";

vi.mock("../oura", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isOuraConnected: vi.fn(async () => true),
    loadOuraData: vi.fn(async () => ({
      "2026-07-08": {
        activity: { data: [{ day: "2026-07-08", active_calories: 450, steps: 12000 }] },
        readiness: { data: [{ day: "2026-07-08", score: 82 }] },
        sleep: { data: [{ day: "2026-07-08", total_sleep_duration: 27000, heart_rate: { lowest: 52 }, hrv: { items: [44, 46] } }] },
      },
    })),
  };
});

vi.mock("../whoop", () => ({
  isWhoopConnected: vi.fn(async () => false),
  loadWhoopData: vi.fn(async () => ({})),
}));

afterEach(cleanup);

function renderToday(overrides = {}) {
  const todayKey = getTodayKey();
  const todayName = getDayName(new Date());
  const day = defaultDay();
  return render(
    <ThemeProvider>
      <TodayTab
        todayName={todayName}
        todayData={overrides.todayData || day}
        updateToday={vi.fn()}
        showToast={vi.fn()}
        onExport={vi.fn()}
        loaded={true}
        program={overrides.program || DEFAULT_PROGRAM}
        settings={{ ...DEFAULT_SETTINGS, ouraConnected: true, onboarded: true }}
        allData={{ [todayKey]: day }}
        logDate={null}
        setLogDate={vi.fn()}
        ouraRecovery={82}
        setTab={vi.fn()}
      />
    </ThemeProvider>
  );
}

describe("TodayTab Oura linked crash reproduction", () => {
  it("renders after Oura linked data loads", async () => {
    renderToday();
    // The integrated Today Command Center is the stable render anchor.
    expect(screen.getAllByText(/Today command/i).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText(/Something broke here/i)).toBeNull());
  });
});
