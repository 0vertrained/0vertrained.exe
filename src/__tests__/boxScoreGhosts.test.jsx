// src/__tests__/boxScoreGhosts.test.jsx
// @vitest-environment jsdom
// The Box Score & Ghost Taps. Pins:
//   (1) ghost priority — carry (today's prior set) > last-time same slot >
//       last-time final set > nothing; ONE chip at the first empty set;
//       explicit tap only (the chip fills, nothing auto-adopts);
//   (2) the rest glance — next set with its slot ghost, next exercise at
//       exercise end, "last set banked" at session end;
//   (3) the Box Score — strict headline priority (PR > arrow > tonnage jump >
//       first-on-record > banked), same-weekday comparison basis, PRs judged
//       against ALL history with straight sets only on BOTH sides (a drop-set
//       "PR" is not a PR), secondaries banked at half, skips named;
//   (4) honest degradation — first same-day session gets no fake deltas;
//   (5) mounted surfaces — the chip fills on tap, the score's backdrop
//       dismisses while the card does not, the finisher fires;
//   (6) wiring guards — skips count as handled in the completion detector,
//       the finisher routes to the active session's cardio slot.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { lastSessionSets, firstEmptyIndex, ghostForSet, buildNextGlance } from "../setGhosts";
import { buildBoxScore } from "../boxScore";
import { GhostChip } from "../GhostChip";
import { SessionComplete } from "../SessionComplete";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
afterEach(cleanup);
const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

const day = (exs) => ({ workout: { exercises: exs } });
const S = (weight, reps, extra = {}) => ({ done: true, weight: String(weight), reps: String(reps), ...extra });

describe("V17.5 ghosts — priority and placement", () => {
  const HIST = {
    "2026-07-10": day({ Bench: { sets: [S(180, 8), S(180, 8), S(180, 7)] } }),
    "2026-07-13": day({ Bench: { sets: [S(185, 8), S(185, 8), S(185, 6)] } }),
  };

  it("lastSessionSets returns the most recent prior day's raw, index-preserved sets", () => {
    const last = lastSessionSets(HIST, "Bench", "2026-07-15");
    expect(last.date).toBe("2026-07-13");
    expect(last.sets).toHaveLength(3);
    expect(last.sets[2]).toEqual({ weight: "185", reps: "6" });
    expect(lastSessionSets(HIST, "Bench", "2026-07-13").date).toBe("2026-07-10"); // strictly prior
    expect(lastSessionSets(HIST, "Squat", "2026-07-15")).toBe(null);
  });

  it("priority: carry beats last-time; last-time uses the SAME slot; overflow uses the final set", () => {
    const last = lastSessionSets(HIST, "Bench", "2026-07-15");
    // Untouched today → last-time slot 0.
    let sets = [{ weight: "", reps: "8" }, { weight: "", reps: "8" }];
    expect(ghostForSet(sets, 0, last)).toMatchObject({ weight: "185", reps: "8", source: "last" });
    // Set 1 logged today → set 2's ghost carries it.
    sets = [S(190, 8), { weight: "", reps: "" }];
    const g = ghostForSet(sets, 1, last);
    expect(g).toMatchObject({ weight: "190", source: "carry", label: "from set 1" });
    // A 4th set today when last time had 3 → last-time final set.
    expect(ghostForSet([{}, {}, {}, {}].map(() => ({ weight: "", reps: "" })), 3, last))
      .toMatchObject({ weight: "185", reps: "6", source: "last" });
    // No history, nothing logged → no chip.
    expect(ghostForSet([{ weight: "", reps: "" }], 0, null)).toBe(null);
  });

  it("one chip only: firstEmptyIndex targets the working set", () => {
    expect(firstEmptyIndex([S(185, 8), { weight: "", reps: "" }, { weight: "", reps: "" }])).toBe(1);
    expect(firstEmptyIndex([S(185, 8), S(185, 8)])).toBe(-1); // all filled → no chip anywhere
  });

  it("the rest glance answers what's next — slot ghost, then next exercise, then banked", () => {
    const last = lastSessionSets(HIST, "Bench", "2026-07-15");
    const sets = [S(190, 8), { done: false, weight: "", reps: "" }, { done: false, weight: "", reps: "" }];
    const g = buildNextGlance({ sets, completedIndex: 0, exerciseName: "Bench", last, nextExerciseName: "Dip" });
    expect(g.line).toBe("Next · set 2 of 3");
    expect(g.ghost).toBe("last time 185×8");
    const doneSets = [S(190, 8), S(190, 8), S(190, 6)];
    expect(buildNextGlance({ sets: doneSets, completedIndex: 2, exerciseName: "Bench", last, nextExerciseName: "Dip" }).line).toBe("Next · Dip");
    expect(buildNextGlance({ sets: doneSets, completedIndex: 2, exerciseName: "Bench", last }).line).toBe("Last set banked");
  });
});

describe("V17.5 Box Score — headline priority and honest math", () => {
  // Mondays: 07-06 and 07-13 share a weekday — the comparison basis.
  const base = {
    "2026-07-06": day({ Bench: { sets: [S(180, 8), S(180, 8)] } }),
    "2026-07-13": day({ Bench: { sets: [S(185, 8), S(185, 8)] } }),
  };

  it("a genuine e1RM PR wins the headline and names the prior best", () => {
    const data = { ...base, "2026-07-20": day({ Bench: { sets: [S(205, 8)] } }) };
    const b = buildBoxScore({ data, todayKey: "2026-07-20", todayName: "Push" });
    expect(b.headline).toBe("PR: Bench.");
    expect(b.prs[0].priorBest).toBeGreaterThan(0);
  });

  it("a drop-set 'PR' is not a PR — straight sets only, both sides", () => {
    const data = { ...base, "2026-07-20": day({ Bench: { sets: [S(205, 8, { type: "drop", segments: [{ weight: "155", reps: "10" }] })] } }) };
    const b = buildBoxScore({ data, todayKey: "2026-07-20", todayName: "Push" });
    expect(b.prs).toHaveLength(0);
    expect(b.headline).not.toMatch(/^PR/);
  });

  it("tonnage compares against the last SAME-weekday session and reports the delta", () => {
    const data = {
      ...base,
      "2026-07-15": day({ Row: { sets: [S(225, 10)] } }), // a Wednesday — must not be the basis
      "2026-07-20": day({ Bench: { sets: [S(185, 8), S(185, 8), S(185, 8)] } }),
    };
    const b = buildBoxScore({ data, todayKey: "2026-07-20", todayName: "Push" });
    expect(b.tonnageCompare.priorDate).toBe("2026-07-13");
    expect(b.tonnage).toBe(185 * 8 * 3);
    expect(typeof b.tonnageCompare.deltaPct).toBe("number");
  });

  it("first same-day session on record: no fake deltas, the baseline headline", () => {
    const data = { "2026-07-20": day({ Bench: { sets: [S(185, 8)] } }) };
    const b = buildBoxScore({ data, todayKey: "2026-07-20", todayName: "Push" });
    expect(b.tonnageCompare).toBe(null);
    expect(b.headline).toMatch(/First Push .* baseline is set/);
  });

  it("banked sets: primaries whole, secondaries half, unmapped excluded; skips named", () => {
    const data = {
      "2026-07-20": day({
        "Incline DB Press": { sets: [S(70, 8), S(70, 8)] },       // chest primary, tri/delt secondary
        "Mystery Machine": { sets: [S(50, 10)] },                  // unmapped → excluded
        "Cable Fly": { skipped: "equipment", sets: [] },
      }),
    };
    const b = buildBoxScore({ data, todayKey: "2026-07-20", todayName: "Push" });
    const chest = b.banked.find((m) => /chest/i.test(m.key) || /chest/i.test(m.label));
    expect(chest?.today).toBe(2);
    const half = b.banked.find((m) => m.today === 1); // 2 secondary-credited sets
    expect(half).toBeTruthy();
    expect(b.skips).toEqual([{ name: "Cable Fly", reason: "equipment" }]);
    expect(b.method).toMatch(/secondaries count half/);
  });
});

describe("V17.5 mounted surfaces", () => {
  it("the chip fills on tap and renders nothing without a ghost", () => {
    const onFill = vi.fn();
    const { getByTestId, rerender, container } = wrap(
      <GhostChip ghost={{ weight: "185", reps: "8", label: "last time · Jul 13" }} onFill={onFill} />
    );
    fireEvent.click(getByTestId("ghost-chip"));
    expect(onFill).toHaveBeenCalledWith({ weight: "185", reps: "8" });
    expect(getByTestId("ghost-chip").textContent).toContain("tap to fill");
    rerender(<ThemeProvider><GhostChip ghost={null} onFill={onFill} /></ThemeProvider>);
    expect(container.textContent).toBe("");
  });

  it("the score: backdrop dismisses, the card does not, the finisher fires without dismissing through", () => {
    const onDismiss = vi.fn();
    const onLog = vi.fn();
    const { getByTestId, getByText } = wrap(
      <SessionComplete
        boxScore={{ headline: "PR: Bench.", tonnage: 4440, tonnageCompare: { priorDate: "2026-07-13", priorTonnage: 2960, deltaPct: 50 }, prs: [{ name: "Bench", e1rm: 231, priorBest: 208 }], arrows: [], banked: [], skips: [{ name: "Cable Fly", reason: "equipment" }], method: "vs your last Push session" }}
        finisher={{ label: "Incline Walk · 1.2 mi", onLog }}
        onDismiss={onDismiss}
      />
    );
    expect(getByText("PR: Bench.")).toBeTruthy();
    expect(getByText(/\+50% vs last/)).toBeTruthy();
    fireEvent.click(getByTestId("box-score")); // the card — no dismissal
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(getByTestId("finisher-log"));
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled(); // stopPropagation held
    fireEvent.click(getByTestId("box-score-backdrop"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("wiring guards: chips at first-empty on both surfaces, glance in the rest bar, skips count as handled, finisher routes by session", () => {
    const today = read("src/TodayTab.jsx");
    expect(today).toContain("index === firstEmptyIndex(sets)");
    expect(today).toContain("isExerciseHandled(exercise");
    expect(today).toContain("workout.cardioSessions.${activeCardioSession.id}.miles");
    const composer = read("src/workout/CurrentSetComposer.jsx");
    expect(composer).toContain("ghostForSet(sets, setIndex, lastRaw)");
    const session = read("src/SessionMode.jsx");
    expect(session).toContain('data-testid="rest-glance"');
    expect(session).toContain('data-testid="skip-row"');
    expect(session).toContain("firstIncompleteExerciseIndex");
  });
});
