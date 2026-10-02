// Pure, null-safe helpers for Social tab summary cards.
// No side effects, no imports, no async — call with raw RPC response arrays.

const CATEGORIES = [
  { key: "total_miles",   label: "Miles",    unit: "mi",   decimals: 1 },
  { key: "workouts_done", label: "Workouts", unit: "",     decimals: 0 },
  { key: "protein_days",  label: "Protein",  unit: "days", decimals: 0 },
  { key: "total_volume",  label: "Volume",   unit: "lbs",  decimals: 0 },
  { key: "water_days",    label: "Water",    unit: "days", decimals: 0 },
];

function safeFloat(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

// Returns { rank (1-based), total, value, gap, gapLabel } for myUsername in category,
// or null if board is empty or username not found.
export function getMyRank(board, myUsername, category) {
  if (!board?.length || !myUsername || !category) return null;
  const ranked = [...board]
    .map(r => ({ username: r.username, value: safeFloat(r[category]) }))
    .sort((a, b) => b.value - a.value);
  const idx = ranked.findIndex(r => r.username === myUsername);
  if (idx === -1) return null;
  const leaderVal = ranked[0].value;
  const myVal = ranked[idx].value;
  const gap = leaderVal - myVal;
  return {
    rank: idx + 1,
    total: ranked.length,
    value: myVal,
    gap,
    gapLabel: gap === 0 ? "You're #1!" : `${gap.toFixed(1)} behind leader`,
  };
}

// Returns { categoryKey, label, unit, rank, total, value, gap, gapLabel } for the
// category where myUsername ranks highest, or null if they don't appear on the board.
export function getBestCategory(board, myUsername) {
  if (!board?.length || !myUsername) return null;
  let best = null;
  for (const cat of CATEGORIES) {
    const info = getMyRank(board, myUsername, cat.key);
    if (!info) continue;
    if (!best || info.rank < best.rank) {
      best = { ...info, categoryKey: cat.key, label: cat.label, unit: cat.unit };
    }
  }
  return best;
}

// Returns an object with per-category averages: { total_miles: number, ... }
// Categories with no data return 0. Null/empty board returns all zeros.
export function getBoardAverages(board) {
  const out = {};
  for (const cat of CATEGORIES) {
    if (!board?.length) { out[cat.key] = 0; continue; }
    const vals = board.map(r => safeFloat(r[cat.key]));
    out[cat.key] = vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  return out;
}

// Builds a hero summary for the leaderboard view.
// Returns { hasData, onBoard?, rank?, total?, value?, gap?, gapLabel?, bestCategory? }
export function buildLeaderboardHero({ board, myUsername, category } = {}) {
  if (!board?.length || !myUsername) return { hasData: false };
  const rankInfo = getMyRank(board, myUsername, category);
  if (!rankInfo) return { hasData: false, onBoard: false };
  const bestCat = getBestCategory(board, myUsername);
  return {
    hasData: true,
    onBoard: true,
    rank: rankInfo.rank,
    total: rankInfo.total,
    value: rankInfo.value,
    gap: rankInfo.gap,
    gapLabel: rankInfo.gapLabel,
    bestCategory: bestCat,
  };
}

// Returns an array of highlight cards derived from leaderboard + PRs.
// Each card: { id, label, value (string), unit, note, tone }
export function buildHighlights({ board, liftPRs, runPRs, myUsername } = {}) {
  const highlights = [];

  // Board leader in each category
  for (const cat of CATEGORIES) {
    if (!board?.length) continue;
    const ranked = [...board]
      .map(r => ({ username: r.username, value: safeFloat(r[cat.key]) }))
      .sort((a, b) => b.value - a.value);
    const leader = ranked[0];
    if (!leader || leader.value === 0) continue;
    const isMe = leader.username === myUsername;
    highlights.push({
      id: `leader_${cat.key}`,
      label: `${cat.label} Leader`,
      value: cat.decimals === 0 ? String(Math.round(leader.value)) : leader.value.toFixed(cat.decimals),
      unit: cat.unit,
      note: leader.username,
      tone: isMe ? "good" : "neutral",
    });
  }

  // Board record per lifting exercise
  if (liftPRs?.length) {
    const byEx = {};
    for (const r of liftPRs) {
      const w = safeFloat(r.best_weight);
      if (!byEx[r.exercise] || w > byEx[r.exercise].value) {
        byEx[r.exercise] = { value: w, username: r.username };
      }
    }
    for (const [ex, rec] of Object.entries(byEx)) {
      if (rec.value === 0) continue;
      highlights.push({
        id: `lift_record_${ex}`,
        label: `${ex} Record`,
        value: String(Math.round(rec.value)),
        unit: "lbs",
        note: rec.username,
        tone: rec.username === myUsername ? "good" : "neutral",
      });
    }
  }

  // Board record running distance
  if (runPRs?.length) {
    const best = [...runPRs]
      .map(r => ({ ...r, v: safeFloat(r.longest_run) }))
      .sort((a, b) => b.v - a.v)[0];
    if (best && best.v > 0) {
      highlights.push({
        id: "run_distance_record",
        label: "Longest Run",
        value: best.v.toFixed(1),
        unit: "mi",
        note: best.username,
        tone: best.username === myUsername ? "good" : "neutral",
      });
    }
  }

  return highlights;
}

// Returns the gap between myUsername's value and the person one rank above them
// in the given category. Returns null when user is #1 or not on the board.
// Positive return = how much the user needs to close to move up one rank.
export function getGapToNext(board, myUsername, category) {
  if (!board?.length || !myUsername || !category) return null;
  const ranked = [...board]
    .map(r => ({ username: r.username, value: safeFloat(r[category]) }))
    .sort((a, b) => b.value - a.value);
  const idx = ranked.findIndex(r => r.username === myUsername);
  if (idx <= 0) return null; // rank 1 (idx=0) or not on board (idx=-1)
  return ranked[idx - 1].value - ranked[idx].value;
}

// Formats a rank delta integer (positive = moved up) into a short badge string.
// Returns null for no-change, null input, or non-finite input.
export function buildDeltaBadge(rankDelta) {
  if (rankDelta === null || rankDelta === undefined) return null;
  const n = typeof rankDelta === 'number' && isFinite(rankDelta) ? Math.round(rankDelta) : NaN;
  if (!isFinite(n) || n === 0) return null;
  return n > 0 ? `+${n} ↑` : `${n} ↓`;
}

function safeFloatOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

// Normalizes the JSONB returned by get_social_summary RPC into safe JS structures.
// Falls back cleanly when server data is absent or malformed.
// Returns { leaderboard, boardAverages, highlights, currentUser }
export function normalizeSocialSummary(serverData) {
  if (!serverData || typeof serverData !== 'object') {
    return { leaderboard: [], boardAverages: {}, highlights: [], currentUser: null };
  }

  const leaderboard = (Array.isArray(serverData.leaderboard) ? serverData.leaderboard : []).map(row => ({
    username:      String(row.username || ''),
    total_miles:   safeFloat(row.total_miles),
    workouts_done: safeFloat(row.workouts_done),
    protein_days:  safeFloat(row.protein_days),
    total_volume:  safeFloat(row.total_volume),
    water_days:    safeFloat(row.water_days),
  }));

  const rawAvg = (serverData.board_averages && typeof serverData.board_averages === 'object')
    ? serverData.board_averages : {};
  const boardAverages = {
    total_miles:   safeFloat(rawAvg.total_miles),
    workouts_done: safeFloat(rawAvg.workouts_done),
    protein_days:  safeFloat(rawAvg.protein_days),
    total_volume:  safeFloat(rawAvg.total_volume),
    water_days:    safeFloat(rawAvg.water_days),
  };

  const highlights = (Array.isArray(serverData.highlights) ? serverData.highlights : [])
    .map(h => ({
      category: String(h.category || ''),
      username:  String(h.username  || ''),
      value:     safeFloat(h.value),
    }))
    .filter(h => h.username && h.value > 0);

  const cu = serverData.current_user;
  const currentUser = (cu && typeof cu === 'object') ? {
    username:     String(cu.username || ''),
    workoutsRank: safeFloatOrNull(cu.workouts_rank),
    totalUsers:   safeFloatOrNull(cu.total_users),
    gapToNext:    safeFloatOrNull(cu.gap_to_next),
    rankDelta:    (cu.rank_delta !== null && cu.rank_delta !== undefined)
                  ? (parseInt(cu.rank_delta, 10) || 0) : null,
    priorRank:    safeFloatOrNull(cu.prior_rank),
  } : null;

  return { leaderboard, boardAverages, highlights, currentUser };
}

function paceToSec(str) {
  if (!str) return Infinity;
  const parts = str.split(":");
  if (parts.length !== 2) return Infinity;
  const mins = parseInt(parts[0], 10);
  const secs = parseInt(parts[1], 10);
  return isFinite(mins) && isFinite(secs) ? mins * 60 + secs : Infinity;
}

// Returns PR comparison data for lifting and running.
// lifting: [{ exercise, boardBest, boardHolder, myBest, gap }]
// running: { distance: { boardBest, boardHolder, myBest, gap },
//            pace: null | { boardBestStr, boardHolder, myBestStr, gapSec } }
export function buildPRComparison({ liftPRs, runPRs, myUsername } = {}) {
  // Lifting — group by exercise, track board best and my best
  const byEx = {};
  for (const r of liftPRs || []) {
    const w = safeFloat(r.best_weight);
    if (!byEx[r.exercise]) byEx[r.exercise] = { boardBest: 0, boardHolder: null, myBest: 0 };
    if (w > byEx[r.exercise].boardBest) {
      byEx[r.exercise].boardBest = w;
      byEx[r.exercise].boardHolder = r.username;
    }
    if (r.username === myUsername && w > byEx[r.exercise].myBest) {
      byEx[r.exercise].myBest = w;
    }
  }
  const lifting = Object.entries(byEx)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([exercise, d]) => ({
      exercise,
      boardBest: d.boardBest,
      boardHolder: d.boardHolder,
      myBest: d.myBest,
      gap: d.boardBest - d.myBest,
    }));

  // Running — distance
  let distBoardBest = 0, distBoardHolder = null, distMyBest = 0;
  for (const r of runPRs || []) {
    const v = safeFloat(r.longest_run);
    if (v > distBoardBest) { distBoardBest = v; distBoardHolder = r.username; }
    if (r.username === myUsername && v > distMyBest) distMyBest = v;
  }

  // Running — pace (lower seconds = faster = better)
  let bestPaceSec = Infinity, paceBoardHolder = null, paceBoardStr = null, myPaceStr = null;
  for (const r of runPRs || []) {
    if (!r.best_pace_str) continue;
    const sec = paceToSec(r.best_pace_str);
    if (sec < bestPaceSec) {
      bestPaceSec = sec;
      paceBoardHolder = r.username;
      paceBoardStr = r.best_pace_str;
    }
    if (r.username === myUsername) myPaceStr = r.best_pace_str;
  }

  const myPaceSec = paceToSec(myPaceStr);
  const paceGapSec =
    myPaceSec !== Infinity && bestPaceSec !== Infinity ? myPaceSec - bestPaceSec : null;

  return {
    lifting,
    running: {
      distance: {
        boardBest: distBoardBest,
        boardHolder: distBoardHolder,
        myBest: distMyBest,
        gap: distBoardBest - distMyBest,
      },
      pace: paceBoardStr
        ? { boardBestStr: paceBoardStr, boardHolder: paceBoardHolder, myBestStr: myPaceStr, gapSec: paceGapSec }
        : null,
    },
  };
}
