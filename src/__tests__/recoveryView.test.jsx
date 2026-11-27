// Recovery as it is read: the call first, then why, the check-in, the
// figures, and the audit behind its own rows. The view only shows what
// RecoveryDashboard resolved, so these tests feed it a resolved morning.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { RecoveryConnected, RecoveryManual, RecoveryLoading } from "../RecoveryView";
import { resolveSharedCall } from "../sharedCall";
import { buildRecoveryVerdict } from "../recovery/verdictResolver";
import { readCheckin } from "../checkinMorning";

const day = (offset) => `2026-11-${String(21 + offset).padStart(2, "0")}`;

function morning(overrides = {}) {
  const recovery = { score: 76, band: "good", scoredDay: "2026-11-27" };
  const sleepDebt = { debtHours: 3.2, band: "Moderate", baselineHours: 7.4, baselineSource: "wearable-need" };
  const alerts = [{ type: "minor_deviation", severity: "caution", message: "1 marker outside normal range.", recommendation: "Normal training is likely fine.", markers: ["hrv_suppressed"] }];
  const checkin = readCheckin({});
  return {
    refreshingLabel: null, demo: false, isBroadsheet: false,
    onOpenCheckin: vi.fn(), onOpenIntegrations: vi.fn(),
    subjectiveRecovery: { score: 70, read: "good to train" },
    manualSummary: "Sleep 7.1h · Stress 6/10",
    manualCompleteness: { filled: 4, total: 9 },
    whoop: { connected: false, summary: null, syncEvents: [] },
    data: {}, todayKey: "2026-11-27", todayPlan: "Upper B", todayBody: {}, checkin,
    recovery, sleepDebt, alerts, conflicts: [],
    verdict: buildRecoveryVerdict({ recovery, sleepDebt, alerts, checkin: { severity: 0, flags: [] } }),
    trend: {
      state: { key: "fresh", name: "Fresh", tone: "steady" },
      delta: { label: "down 10" },
      evidence: ["HRV is running 6% above your normal range.", "Resting heart rate is steady."],
      meaning: { what: "What it is.", why: "Why it is.", action: "What to do." },
      early: false,
    },
    provenance: null,
    changeSummary: { hasFlags: true, rows: [{ key: "hrv", label: "HRV balance", value: "19/35 · z -1.48", tone: "warning", sentence: "Last night’s HRV was well below your baseline." }] },
    coachInterp: { cluster: "One or two markers are drifting from baseline.", guidance: "Proceed with the planned session.", body: null, confidenceNote: "high data confidence.", tone: "caution" },
    recoveryHistory: [84, 62, 95, 97, 67, 93, 76].map((value, index) => ({ date: day(index), value })),
    hrv: { score: 19, zScore: -1.48, cv: 2.6, sampleCount: 14 },
    rhr: { score: 20, delta: 0.5 },
    sleep: { nightly: 22 },
    temp: { score: 15, consecutiveNights: 0 },
    rawMetrics: { hrv: "53 ms", rhr: "60 bpm", sleep: "7.3h slept · 0.0h debt · 83/100 Oura sleep score", temp: "0.30°C deviation" },
    sources: { hrv: "raw sleep HRV" }, baselines: {},
    trainingLoad: { rolling: { zone: "optimal", ratio: 0.98, acute: 298, chronic: 303, trend: "stable" }, zoneInfo: { label: "Optimal", description: "This week matches your usual month.", recommendation: "Train as planned." } },
    externalCardio: null, unloggedFlags: [],
    edition: { available: false, onOpen: vi.fn() },
    reconnect: false, firstSync: false, connected: true, manualOn: true,
    qa: null, blendExplanation: null, confidenceExplanation: null, aggregatedContext: null,
    heroMeta: { source: "Oura biometrics", latestDay: "2026-11-27", stale: false },
    syncFreshness: "2m ago · recent", tokenStatus: { syncStatus: "recent" }, quality: null,
    confidence: { level: "high", reason: "raw signals across the window" },
    blendedRecommendation: null, resolvedRecommendation: { label: "Normal Load" }, alertHistory: {},
    ...overrides,
  };
}

function mount(overrides) {
  const view = morning(overrides);
  const rendered = render(<ThemeProvider><RecoveryConnected view={view} /></ThemeProvider>);
  return { ui: within(rendered.container), container: rendered.container, view };
}

describe("Recovery, connected", () => {
  it("leads with the call: a word, an effort level, the score and one sentence", () => {
    const { ui, container, view } = mount();
    // 76 with sleep debt: the plan stands, with a ceiling named in the reasons.
    expect(container.querySelector(".stamp").textContent).toBe("Train");
    expect(ui.getByRole("img", { name: "Effort level 4 of 5" })).toBeTruthy();
    const call = within(ui.getByRole("heading", { level: 2, name: view.verdict.headline }).closest("section"));
    expect(call.getByText("76")).toBeTruthy();
    // No check-in yet: the call says so and stands anyway.
    expect(call.getByText("Fresh · score down 10 on the last 3 days · before check-in")).toBeTruthy();
  });

  it("shows the app's one call when Today's read is more cautious, and says so first", () => {
    const sharedCall = resolveSharedCall({ todayCall: "modify", recoveryVerdict: { call: "train" }, score: 76 });
    const todayCall = { call: "modify", reasons: ["Recovery 76/100 via Oura", "High soreness (8/10) — pulling the call back."] };
    const { ui, container } = mount({ sharedCall, todayCall });
    expect(container.querySelector(".stamp").textContent).toBe("Easy");
    expect(ui.getByRole("img", { name: "Effort level 2 of 5" })).toBeTruthy();
    const call = within(ui.getByRole("heading", { level: 2, name: sharedCall.headline }).closest("section"));
    expect(call.getByText("76")).toBeTruthy();
    expect(ui.getByTestId("today-caution").textContent).toBe("Today’s read is more cautious, so the call follows it. High soreness (8/10) — pulling the call back.");
  });

  it("explains a connected first sync and shows the plan until a score arrives", () => {
    const sharedCall = resolveSharedCall({ todayCall: "maintain" });
    const { ui } = mount({ sharedCall, verdict: null, recovery: { score: null, band: "insufficient_data" }, firstSync: true });
    const hero = within(ui.getByRole("heading", { name: sharedCall.headline }).closest("section"));
    expect(hero.getByText(/Waiting for today’s wearable signals/)).toBeTruthy();
    expect(hero.getByText("—")).toBeTruthy();
  });

  it("labels a stale score by its date and displays a current check-in as manual", () => {
    const sharedCall = resolveSharedCall({ todayCall: "push", score: 82 });
    const { ui } = mount({ sharedCall, todayCall: { call: "push" }, verdict: null, recovery: { score: 0, scoredDay: "2026-11-25" } });
    const hero = within(ui.getByRole("heading", { name: sharedCall.headline }).closest("section"));
    expect(hero.getByText("82")).toBeTruthy();
    expect(hero.getByText("Score from your check-in.")).toBeTruthy();
    expect(hero.getByText(/Last wearable score was 0\/100 on 2026-11-25/)).toBeTruthy();
  });

  it("uses trend evidence before the resolver explanation and can explain a manual-only call", () => {
    const fresh = mount();
    const why = within(fresh.ui.getByRole("region", { name: "Why this call" }));
    expect(why.getByText(fresh.view.trend.evidence[0])).toBeTruthy();
    expect(why.queryByText(fresh.view.verdict.deck)).toBeNull();
    const noTrend = mount({ trend: null });
    expect(within(noTrend.ui.getByRole("region", { name: "Why this call" })).getByText(noTrend.view.verdict.deck)).toBeTruthy();
    const manual = mount({ recovery: null, verdict: null, trend: null, sharedCall: resolveSharedCall({ todayCall: "maintain" }), todayCall: { reasons: ["Follow your planned session."] } });
    expect(within(manual.ui.getByRole("region", { name: "Why this call" })).getByText("Follow your planned session.")).toBeTruthy();
  });

  it("compares a complete check-in only with a current score and names recently trained muscles", () => {
    const checkin = readCheckin({ sleepQuality: 9, soreness: 2, energy: 9, stress: 2 });
    const data = { "2026-11-26": { workout: { exercises: { Bench: { sets: [{ done: true }] } } } } };
    const current = mount({ checkin, data, recovery: { score: 0, scoredDay: "2026-11-27" } });
    const why = within(current.ui.getByRole("region", { name: "Why this call" }));
    expect(why.getByText(/You feel better than your metrics look/)).toBeTruthy();
    expect(why.getByText(/Today: Upper B.*Recently loaded: Chest \(1d\)/)).toBeTruthy();
    const stale = mount({ checkin, data, recovery: { score: 0, scoredDay: "2026-11-26" }, verdict: null, sharedCall: resolveSharedCall({ todayCall: "maintain" }) });
    expect(stale.ui.queryByText(/than your metrics look/)).toBeNull();
  });

  it("names no other read when the call is Recovery's own", () => {
    const sharedCall = resolveSharedCall({ todayCall: "maintain", recoveryVerdict: { call: "train" }, score: 76 });
    const { ui } = mount({ sharedCall, todayCall: { call: "maintain", reasons: [] } });
    expect(sharedCall.source).toBe("both");
    expect(ui.queryByTestId("today-caution")).toBeNull();
  });

  it("gives its reasons as sentences, with the limiter first and last night's flags marked", () => {
    const { ui } = mount();
    const why = within(ui.getByRole("heading", { name: "Why this call" }).closest("section"));
    expect(why.getByText(/^Ceiling: sleep debt 3h 12m\.$/)).toBeTruthy();
    expect(why.getByText("HRV is running 6% above your normal range.")).toBeTruthy();
    expect(why.getByText("Last night’s HRV was well below your baseline.")).toBeTruthy();
    expect(why.getByText("Warning")).toBeTruthy();
    expect(why.getByText(/^Today: Upper B\. These are likely limiters, not a diagnosis\.$/)).toBeTruthy();
    fireEvent.click(why.getByRole("button", { name: "What does this mean?" }));
    expect(ui.getByRole("dialog", { name: "What this call means" })).toBeTruthy();
    expect(ui.getByText("Why it is.")).toBeTruthy();
  });

  it("raises a warning as an alert and a caution as a note", () => {
    const calm = mount();
    expect(calm.ui.queryByRole("alert")).toBeNull();
    expect(calm.ui.getByText("Caution: minor deviation")).toBeTruthy();
    const ill = mount({ alerts: [{ type: "illness_warning", severity: "warning", message: "Several markers are off together.", recommendation: "Rest today.", markers: [] }] });
    expect(within(ill.ui.getByRole("alert")).getByText("Warning: illness warning")).toBeTruthy();
  });

  it("shows the check-in with its way to Today", () => {
    const { ui, view } = mount();
    const banner = within(ui.getByTestId("checkin-line"));
    expect(banner.getByText("No check-in yet today.")).toBeTruthy();
    fireEvent.click(banner.getByRole("button", { name: "Check in on Today" }));
    expect(view.onOpenCheckin).toHaveBeenCalledTimes(1);
  });

  it("draws the week as a chart with its numbers in a table", () => {
    const { ui } = mount();
    expect(ui.getByRole("img", { name: "Line chart of recovery score for 7 days, from 84 to 76, with its 3-day average at 79." })).toBeTruthy();
    expect(ui.getByText("Today is 76. The 3-day average is 79 and falling.")).toBeTruthy();
    const trend = within(ui.getByRole("heading", { name: /^Trend, 7\sdays$/ }).closest("section"));
    fireEvent.click(trend.getByRole("button", { name: "Show as table" }));
    expect(trend.getByRole("table", { name: "Recovery score by day, newest first" })).toBeTruthy();
  });

  it("keeps the audit behind named rows that open in place", () => {
    const { ui } = mount();
    const row = ui.getByRole("button", { name: /^Data trust/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(ui.queryByText("How the score is made")).toBeNull();
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(ui.getByText("How the score is made")).toBeTruthy();
    expect(ui.getByText(/against 7\.4\sh a night, baseline need \(Whoop\) · naps credited$/)).toBeTruthy();
    expect(ui.getByRole("button", { name: /^Wearables/ }).getAttribute("aria-expanded")).toBe("false");
    expect(ui.getByRole("button", { name: /^The coach’s read/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("puts a lapsed connection and the weekly edition above the call", () => {
    const { ui, view } = mount({ reconnect: true, edition: { available: true, onOpen: vi.fn() } });
    const order = [
      ui.getByRole("alert"), ui.getByTestId("sunday-edition-line"),
      ui.getByRole("heading", { name: view.verdict.headline }), ui.getByText(/Fresh · score down/),
      ui.getByText("Caution: minor deviation"), ui.getByRole("heading", { name: "Why this call" }),
      ui.getByTestId("checkin-line"), ui.getByRole("heading", { name: /^Trend,/ }),
      ui.getByRole("heading", { name: "Drivers" }), ui.getByRole("heading", { name: "Training load" }),
      ui.getByRole("button", { name: /^Wearables/ }),
    ];
    order.slice(1).forEach((node, i) => expect(Boolean(order[i].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true));
    const why = within(ui.getByRole("region", { name: "Why this call" }));
    expect(why.getByText(view.verdict.limiter.detail, { exact: false })).toBeTruthy();
    fireEvent.click(within(ui.getByRole("alert")).getByRole("button", { name: "Reconnect Oura" }));
    expect(view.onOpenIntegrations).toHaveBeenCalledTimes(1);
    fireEvent.click(ui.getByTestId("sunday-edition-line"));
    expect(view.edition.onOpen).toHaveBeenCalledTimes(1);
    expect(mount().ui.queryByTestId("sunday-edition-line")).toBeNull();
  });
});

describe("Recovery, manual and loading", () => {
  it("treats the manual check-in as a complete read", () => {
    const view = { ...morning(), interpretation: { cluster: "Manual check-in is your primary readiness signal today.", guidance: "Train in line with a good to train day.", body: null, confidenceNote: null } };
    const rendered = render(<ThemeProvider><RecoveryManual view={view} /></ThemeProvider>);
    const ui = within(rendered.container);
    expect(rendered.container.querySelector(".stamp").textContent).toBe("Manual");
    expect(ui.getByText("70")).toBeTruthy();
    expect(ui.getByRole("heading", { level: 2, name: "Good to train" })).toBeTruthy();
    expect(ui.getByText("4 of 9 fields")).toBeTruthy();
    expect(ui.getByText("Sleep 7.1h")).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Edit check-in on Today" }));
    expect(view.onOpenCheckin).toHaveBeenCalledTimes(1);
  });

  it("says what is loading", () => {
    const rendered = render(<ThemeProvider><RecoveryLoading /></ThemeProvider>);
    expect(within(rendered.container).getByRole("status").textContent).toContain("Loading your recovery");
  });
});
