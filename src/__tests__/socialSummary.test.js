import { describe, expect, it } from "vitest";
import {
  getMyRank,
  getBestCategory,
  getBoardAverages,
  buildLeaderboardHero,
  buildHighlights,
  buildPRComparison,
  getGapToNext,
  buildDeltaBadge,
  normalizeSocialSummary,
} from "../socialSummary";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const board = [
  { username: "alice", total_miles: 25,    workouts_done: 6, protein_days: 5, total_volume: 12000, water_days: 6 },
  { username: "bob",   total_miles: 18,    workouts_done: 4, protein_days: 4, total_volume: 15000, water_days: 3 },
  { username: "carol", total_miles: 10,    workouts_done: 5, protein_days: 6, total_volume: 8000,  water_days: 5 },
];

const liftPRs = [
  { exercise: "Squat",    best_weight: "315", username: "alice" },
  { exercise: "Squat",    best_weight: "285", username: "bob"   },
  { exercise: "Deadlift", best_weight: "405", username: "bob"   },
  { exercise: "Deadlift", best_weight: "365", username: "alice" },
];

const runPRs = [
  { longest_run: "13.1", best_pace_str: "8:30", username: "alice" },
  { longest_run: "10",   best_pace_str: "7:45", username: "bob"   },
  { longest_run: "6",    best_pace_str: "9:00", username: "carol" },
];

// ── getMyRank ─────────────────────────────────────────────────────────────────
describe("getMyRank", () => {
  it("returns correct rank and gap for a user mid-board", () => {
    const result = getMyRank(board, "bob", "total_miles");
    expect(result).not.toBeNull();
    expect(result.rank).toBe(2);
    expect(result.total).toBe(3);
    expect(result.value).toBe(18);
    expect(result.gap).toBeCloseTo(7);
    expect(result.gapLabel).toMatch(/7\.0 behind leader/);
  });

  it("returns rank 1 and zero gap for the leader", () => {
    const result = getMyRank(board, "alice", "total_miles");
    expect(result.rank).toBe(1);
    expect(result.gap).toBe(0);
    expect(result.gapLabel).toMatch(/You're #1/);
  });

  it("returns null if user not on board", () => {
    expect(getMyRank(board, "dave", "total_miles")).toBeNull();
  });

  it("returns null for empty board", () => {
    expect(getMyRank([], "alice", "total_miles")).toBeNull();
  });

  it("returns null for null board", () => {
    expect(getMyRank(null, "alice", "total_miles")).toBeNull();
  });

  it("returns null for missing username", () => {
    expect(getMyRank(board, null, "total_miles")).toBeNull();
  });

  it("returns null for missing category", () => {
    expect(getMyRank(board, "alice", null)).toBeNull();
  });

  it("produces no NaN in rank or gap", () => {
    const result = getMyRank(board, "carol", "total_miles");
    expect(isNaN(result.rank)).toBe(false);
    expect(isNaN(result.gap)).toBe(false);
    expect(result.gapLabel).not.toMatch(/NaN/);
  });
});

// ── getBestCategory ───────────────────────────────────────────────────────────
describe("getBestCategory", () => {
  it("returns the category where user ranks highest", () => {
    // carol: protein_days=6, leads (alice=5, bob=4) → rank 1
    const result = getBestCategory(board, "carol");
    expect(result).not.toBeNull();
    expect(result.categoryKey).toBe("protein_days");
    expect(result.rank).toBe(1);
  });

  it("returns null for empty board", () => {
    expect(getBestCategory([], "alice")).toBeNull();
  });

  it("returns null for user not on board", () => {
    expect(getBestCategory(board, "dave")).toBeNull();
  });

  it("returns null for null board", () => {
    expect(getBestCategory(null, "alice")).toBeNull();
  });
});

// ── getBoardAverages ──────────────────────────────────────────────────────────
describe("getBoardAverages", () => {
  it("calculates correct averages for each category", () => {
    const avgs = getBoardAverages(board);
    expect(avgs.total_miles).toBeCloseTo((25 + 18 + 10) / 3);
    expect(avgs.workouts_done).toBeCloseTo((6 + 4 + 5) / 3);
    expect(avgs.protein_days).toBeCloseTo((5 + 4 + 6) / 3);
    expect(avgs.total_volume).toBeCloseTo((12000 + 15000 + 8000) / 3);
  });

  it("returns zeros for empty board", () => {
    const avgs = getBoardAverages([]);
    for (const v of Object.values(avgs)) expect(v).toBe(0);
  });

  it("returns zeros for null board", () => {
    const avgs = getBoardAverages(null);
    for (const v of Object.values(avgs)) expect(v).toBe(0);
  });

  it("produces no NaN in averages", () => {
    const avgs = getBoardAverages(board);
    for (const v of Object.values(avgs)) expect(isNaN(v)).toBe(false);
  });
});

// ── buildLeaderboardHero ──────────────────────────────────────────────────────
describe("buildLeaderboardHero", () => {
  it("returns full hero data when user is on board", () => {
    const hero = buildLeaderboardHero({ board, myUsername: "bob", category: "total_miles" });
    expect(hero.hasData).toBe(true);
    expect(hero.onBoard).toBe(true);
    expect(hero.rank).toBe(2);
    expect(hero.gap).toBeGreaterThan(0);
    expect(hero.bestCategory).not.toBeNull();
  });

  it("returns hasData false for empty board", () => {
    const hero = buildLeaderboardHero({ board: [], myUsername: "alice", category: "total_miles" });
    expect(hero.hasData).toBe(false);
  });

  it("returns hasData false for null username", () => {
    expect(buildLeaderboardHero({ board, myUsername: null, category: "total_miles" }).hasData).toBe(false);
  });

  it("returns hasData false with no args", () => {
    expect(buildLeaderboardHero({}).hasData).toBe(false);
  });

  it("marks onBoard false when username missing from rows", () => {
    const hero = buildLeaderboardHero({ board, myUsername: "nobody", category: "total_miles" });
    expect(hero.hasData).toBe(false);
    expect(hero.onBoard).toBe(false);
  });
});

// ── buildHighlights ───────────────────────────────────────────────────────────
describe("buildHighlights", () => {
  it("returns a highlight card for each board category leader", () => {
    const cards = buildHighlights({ board, liftPRs: [], runPRs: [], myUsername: "alice" });
    const milesCard = cards.find(c => c.id === "leader_total_miles");
    expect(milesCard).toBeTruthy();
    expect(milesCard.value).toBe("25.0"); // decimals=1 → toFixed(1)
    expect(milesCard.tone).toBe("good");  // alice leads miles
  });

  it("marks card tone neutral when user is not the category leader", () => {
    const cards = buildHighlights({ board, liftPRs: [], runPRs: [], myUsername: "carol" });
    const milesCard = cards.find(c => c.id === "leader_total_miles");
    expect(milesCard.tone).toBe("neutral");
  });

  it("includes lifting record highlights", () => {
    const cards = buildHighlights({ board: [], liftPRs, runPRs: [], myUsername: "bob" });
    const deadlift = cards.find(c => c.id === "lift_record_Deadlift");
    expect(deadlift).toBeTruthy();
    expect(deadlift.value).toBe("405");
    expect(deadlift.note).toBe("bob");
    expect(deadlift.tone).toBe("good"); // bob holds deadlift record
  });

  it("marks lifting record neutral when user is not the record holder", () => {
    const cards = buildHighlights({ board: [], liftPRs, runPRs: [], myUsername: "alice" });
    const deadlift = cards.find(c => c.id === "lift_record_Deadlift");
    expect(deadlift.tone).toBe("neutral");
  });

  it("includes running distance record highlight", () => {
    const cards = buildHighlights({ board: [], liftPRs: [], runPRs, myUsername: "carol" });
    const run = cards.find(c => c.id === "run_distance_record");
    expect(run).toBeTruthy();
    expect(run.value).toBe("13.1");
    expect(run.tone).toBe("neutral"); // carol is not the distance record holder
  });

  it("returns empty array when all inputs are empty", () => {
    const cards = buildHighlights({ board: [], liftPRs: [], runPRs: [], myUsername: "alice" });
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBe(0);
  });

  it("is null-safe with no inputs — no NaN in values", () => {
    const cards = buildHighlights({});
    expect(Array.isArray(cards)).toBe(true);
    for (const c of cards) {
      expect(c.value).not.toMatch(/NaN/);
    }
  });
});

// ── buildPRComparison ─────────────────────────────────────────────────────────
describe("buildPRComparison", () => {
  it("groups lifting by exercise with correct board best and my best when user holds record", () => {
    const result = buildPRComparison({ liftPRs, runPRs, myUsername: "alice" });
    const squat = result.lifting.find(e => e.exercise === "Squat");
    expect(squat).toBeTruthy();
    expect(squat.boardBest).toBe(315);
    expect(squat.boardHolder).toBe("alice");
    expect(squat.myBest).toBe(315);
    expect(squat.gap).toBe(0);
  });

  it("shows positive gap when user is not the board record holder", () => {
    const result = buildPRComparison({ liftPRs, runPRs, myUsername: "alice" });
    const dl = result.lifting.find(e => e.exercise === "Deadlift");
    expect(dl.boardBest).toBe(405);
    expect(dl.boardHolder).toBe("bob");
    expect(dl.myBest).toBe(365);
    expect(dl.gap).toBe(40);
  });

  it("shows gap 0 when user is the board record holder for that exercise", () => {
    const result = buildPRComparison({ liftPRs, runPRs, myUsername: "bob" });
    const dl = result.lifting.find(e => e.exercise === "Deadlift");
    expect(dl.gap).toBe(0);
  });

  it("returns running distance comparison with correct values", () => {
    const result = buildPRComparison({ liftPRs, runPRs, myUsername: "carol" });
    expect(result.running.distance.boardBest).toBeCloseTo(13.1);
    expect(result.running.distance.boardHolder).toBe("alice");
    expect(result.running.distance.myBest).toBeCloseTo(6);
    expect(result.running.distance.gap).toBeCloseTo(7.1);
  });

  it("returns running pace comparison with the fastest pace as board best", () => {
    const result = buildPRComparison({ liftPRs, runPRs, myUsername: "alice" });
    expect(result.running.pace).not.toBeNull();
    expect(result.running.pace.boardBestStr).toBe("7:45"); // bob is fastest
    expect(result.running.pace.boardHolder).toBe("bob");
    expect(result.running.pace.myBestStr).toBe("8:30");
    expect(result.running.pace.gapSec).toBeGreaterThan(0); // alice is slower than bob
  });

  it("handles null lifting and running PRs without crashing", () => {
    const result = buildPRComparison({ liftPRs: null, runPRs: null, myUsername: "alice" });
    expect(Array.isArray(result.lifting)).toBe(true);
    expect(result.lifting.length).toBe(0);
    expect(result.running.distance.boardBest).toBe(0);
    expect(result.running.pace).toBeNull();
  });

  it("shows zero myBest when user has no lifting PRs on the board", () => {
    const result = buildPRComparison({ liftPRs, runPRs, myUsername: "carol" });
    const squat = result.lifting.find(e => e.exercise === "Squat");
    expect(squat.myBest).toBe(0);
    expect(isNaN(squat.gap)).toBe(false);
    expect(squat.gap).toBe(315); // full gap to board best
  });

  it("produces no NaN in any gap field", () => {
    const result = buildPRComparison({ liftPRs, runPRs, myUsername: "carol" });
    for (const e of result.lifting) {
      expect(isNaN(e.gap)).toBe(false);
    }
    expect(isNaN(result.running.distance.gap)).toBe(false);
  });
});

// ── getGapToNext ──────────────────────────────────────────────────────────────
describe("getGapToNext", () => {
  it("returns gap to the person one rank above", () => {
    // board: alice 25 mi > bob 18 mi > carol 10 mi
    const gap = getGapToNext(board, "bob", "total_miles");
    expect(gap).toBeCloseTo(7); // alice 25 - bob 18
  });

  it("returns null when user is #1 (no one above)", () => {
    expect(getGapToNext(board, "alice", "total_miles")).toBeNull();
  });

  it("returns gap correctly for last-place user", () => {
    // carol 10 mi, bob 18 mi above her
    const gap = getGapToNext(board, "carol", "total_miles");
    expect(gap).toBeCloseTo(8); // bob 18 - carol 10
  });

  it("returns null for user not on the board", () => {
    expect(getGapToNext(board, "dave", "total_miles")).toBeNull();
  });

  it("returns null for empty board", () => {
    expect(getGapToNext([], "alice", "total_miles")).toBeNull();
  });

  it("returns null for null board", () => {
    expect(getGapToNext(null, "alice", "total_miles")).toBeNull();
  });

  it("returns null for missing username", () => {
    expect(getGapToNext(board, null, "total_miles")).toBeNull();
  });

  it("returns null for missing category", () => {
    expect(getGapToNext(board, "bob", null)).toBeNull();
  });

  it("produces no NaN", () => {
    const gap = getGapToNext(board, "carol", "total_volume");
    expect(isNaN(gap)).toBe(false);
  });

  it("handles string numeric values safely", () => {
    const b = [
      { username: "x", total_miles: "20" },
      { username: "y", total_miles: "abc" }, // malformed
      { username: "z", total_miles: "10" },
    ];
    const gap = getGapToNext(b, "z", "total_miles");
    // x=20, y=0 (safeFloat), z=10 → z is rank 2 behind x
    expect(gap).toBeCloseTo(10);
    expect(isNaN(gap)).toBe(false);
  });
});

// ── buildDeltaBadge ───────────────────────────────────────────────────────────
describe("buildDeltaBadge", () => {
  it("returns positive badge for upward movement", () => {
    expect(buildDeltaBadge(2)).toBe("+2 ↑");
  });

  it("returns negative badge for downward movement", () => {
    expect(buildDeltaBadge(-1)).toBe("-1 ↓");
  });

  it("returns null for no change", () => {
    expect(buildDeltaBadge(0)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(buildDeltaBadge(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(buildDeltaBadge(undefined)).toBeNull();
  });

  it("returns null for NaN input", () => {
    expect(buildDeltaBadge(NaN)).toBeNull();
  });

  it("rounds fractional deltas", () => {
    expect(buildDeltaBadge(1.7)).toBe("+2 ↑");
    expect(buildDeltaBadge(-1.3)).toBe("-1 ↓");
  });
});

// ── normalizeSocialSummary ────────────────────────────────────────────────────
describe("normalizeSocialSummary", () => {
  const serverData = {
    leaderboard: [
      { username: "alice", total_miles: "25.00", workouts_done: 6, protein_days: 5, total_volume: "12000", water_days: 6 },
      { username: "bob",   total_miles: "18",    workouts_done: 4, protein_days: 4, total_volume: "15000", water_days: 3 },
    ],
    board_averages: { total_miles: "21.50", workouts_done: "5.00", protein_days: "4.50", total_volume: "13500.00", water_days: "4.50" },
    highlights: [
      { category: "total_miles",   username: "alice", value: "25.00" },
      { category: "workouts_done", username: "alice", value: 6 },
      { category: "total_volume",  username: "bob",   value: "15000" },
    ],
    current_user: {
      username: "bob",
      workouts_rank: 2,
      total_users: 2,
      gap_to_next: 2,
      rank_delta: 1,
      prior_rank: 3,
    },
  };

  it("normalizes leaderboard rows — converts string numerics to numbers", () => {
    const { leaderboard } = normalizeSocialSummary(serverData);
    expect(leaderboard).toHaveLength(2);
    expect(leaderboard[0].total_miles).toBe(25);
    expect(leaderboard[1].total_volume).toBe(15000);
    expect(typeof leaderboard[0].workouts_done).toBe("number");
  });

  it("produces no NaN in leaderboard rows", () => {
    const { leaderboard } = normalizeSocialSummary(serverData);
    for (const row of leaderboard) {
      for (const v of Object.values(row)) {
        if (typeof v === "number") expect(isNaN(v)).toBe(false);
      }
    }
  });

  it("normalizes board averages from string numerics", () => {
    const { boardAverages } = normalizeSocialSummary(serverData);
    expect(boardAverages.total_miles).toBeCloseTo(21.5);
    expect(boardAverages.workouts_done).toBeCloseTo(5);
    expect(isNaN(boardAverages.total_volume)).toBe(false);
  });

  it("normalizes highlights with value > 0 filter", () => {
    const { highlights } = normalizeSocialSummary(serverData);
    expect(highlights).toHaveLength(3);
    expect(highlights[0].username).toBe("alice");
    expect(highlights[0].value).toBe(25);
  });

  it("filters out highlights with zero or invalid value", () => {
    const withBadHighlight = {
      ...serverData,
      highlights: [
        { category: "total_miles", username: "alice", value: "0" },
        { category: "workouts_done", username: "", value: 6 },
        { category: "total_volume", username: "bob", value: "abc" },
      ],
    };
    const { highlights } = normalizeSocialSummary(withBadHighlight);
    expect(highlights).toHaveLength(0);
  });

  it("normalizes currentUser rank/gap fields", () => {
    const { currentUser } = normalizeSocialSummary(serverData);
    expect(currentUser).not.toBeNull();
    expect(currentUser.workoutsRank).toBe(2);
    expect(currentUser.gapToNext).toBe(2);
    expect(currentUser.rankDelta).toBe(1);
    expect(currentUser.priorRank).toBe(3);
    expect(currentUser.totalUsers).toBe(2);
  });

  it("returns null currentUser when current_user is absent", () => {
    const { currentUser } = normalizeSocialSummary({ ...serverData, current_user: null });
    expect(currentUser).toBeNull();
  });

  it("returns null currentUser.gapToNext when server sends null (user is #1)", () => {
    const { currentUser } = normalizeSocialSummary({
      ...serverData,
      current_user: { ...serverData.current_user, gap_to_next: null },
    });
    expect(currentUser.gapToNext).toBeNull();
  });

  it("returns null rankDelta when server sends null (all-time period)", () => {
    const { currentUser } = normalizeSocialSummary({
      ...serverData,
      current_user: { ...serverData.current_user, rank_delta: null },
    });
    expect(currentUser.rankDelta).toBeNull();
  });

  it("handles malformed numeric fields without NaN", () => {
    const malformed = {
      leaderboard: [{ username: "x", total_miles: "bad", workouts_done: null, protein_days: "", total_volume: undefined, water_days: "NaN" }],
      board_averages: { total_miles: "bad", workouts_done: null },
      highlights: [],
      current_user: null,
    };
    const { leaderboard, boardAverages } = normalizeSocialSummary(malformed);
    for (const v of Object.values(leaderboard[0])) {
      if (typeof v === "number") expect(isNaN(v)).toBe(false);
    }
    for (const v of Object.values(boardAverages)) {
      expect(isNaN(v)).toBe(false);
    }
  });

  it("returns empty defaults for null input", () => {
    const result = normalizeSocialSummary(null);
    expect(result.leaderboard).toEqual([]);
    expect(result.highlights).toEqual([]);
    expect(result.currentUser).toBeNull();
  });

  it("returns empty defaults for non-object input", () => {
    const result = normalizeSocialSummary("not an object");
    expect(result.leaderboard).toEqual([]);
    expect(result.currentUser).toBeNull();
  });
});
