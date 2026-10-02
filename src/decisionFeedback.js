/**
 * src/decisionFeedback.js
 *
 * Pure helpers for analyzing decision response patterns and feedback.
 * Converts stored decision responses into summaries, stats, and confidence messaging.
 * No side effects. Used by Today card and Progress weekly review.
 */

/**
 * Aggregate decision responses from daily data.
 * @param {object} data - Map of date keys to daily data objects
 * @param {number} maxDays - Optional limit (default 365, recent first)
 * @returns {object} Aggregated stats with counts, ratio, confidence, and patterns
 */
export function aggregateDecisionResponses(data = {}, maxDays = 365) {
  const entries = [];

  // Collect all decision responses with their dates
  for (const [dateKey, dayData] of Object.entries(data)) {
    const resp = dayData?.intelligence?.todayDecisionResponse;
    if (resp && resp.response) {
      entries.push({
        dateKey,
        call: resp.decisionCall || "unknown",
        response: resp.response,
        recordedAt: resp.recordedAt,
      });
    }
  }

  // Sort by date, keep most recent N days
  entries.sort((a, b) => (b.dateKey || "").localeCompare(a.dateKey || ""));
  entries.splice(maxDays);

  // Calculate stats
  const stats = {
    followed: 0,
    modified: 0,
    ignored: 0,
    skipped: 0,
    total: entries.length,
  };

  const callBreakdown = {};

  for (const entry of entries) {
    stats[entry.response]++;
    callBreakdown[entry.call] = (callBreakdown[entry.call] || 0) + 1;
  }

  // Adherence: followed + modified / total (user is respecting the decision)
  const adherence = entries.length > 0 ? (stats.followed + stats.modified) / entries.length : 0;

  // Implementation: followed / (followed + modified) (of those who engaged, how many fully followed)
  const implementation = stats.followed + stats.modified > 0
    ? stats.followed / (stats.followed + stats.modified)
    : 0;

  return {
    stats,
    callBreakdown,
    entries: entries.slice(0, 30), // Latest 30 for pattern analysis
    adherence,
    implementation,
    confidence: entries.length >= 10 ? "high" : entries.length >= 5 ? "medium" : "low",
  };
}

/**
 * Build a brief feedback message about decision response patterns.
 * Used for the Today Decision card's compact feedback line.
 * @param {object} data - Daily data map
 * @returns {string} Brief 1-line feedback or empty string if insufficient data
 */
export function getDecisionFeedbackBrief(data = {}) {
  const agg = aggregateDecisionResponses(data, 14); // Last 2 weeks

  if (agg.stats.total === 0) return ""; // No data
  if (agg.stats.total < 2) return ""; // Too sparse for feedback

  // Positive pattern
  if (agg.stats.followed >= agg.stats.ignored) {
    const pct = Math.round(agg.adherence * 100);
    return `You're following recommendations ${pct}% of the time.`;
  }

  // Mixed pattern
  if (agg.stats.modified > agg.stats.followed) {
    return `You often customize recommendations — that's fine, make adjustments as needed.`;
  }

  // Ignoring pattern
  if (agg.stats.ignored >= agg.stats.followed + agg.stats.modified) {
    return `Consider why you're not following recommendations — adjust them or your training if there's a mismatch.`;
  }

  return "";
}

/**
 * Get confidence/quality messaging for sparse decision response history.
 * @param {object} data - Daily data map (most recent only, not all-time)
 * @returns {object} { message: string, level: "low" | "medium" | "high" }
 */
export function getDecisionDataQuality(data = {}) {
  // Only look at last 14 days for recency
  const agg = aggregateDecisionResponses(data, 14);

  if (agg.stats.total === 0) {
    return {
      message: "No decision responses logged yet. Tap the decision to feedback your choice.",
      level: "low",
    };
  }

  if (agg.stats.total < 3) {
    return {
      message: "Data sparse — log a few more decision responses to see patterns.",
      level: "low",
    };
  }

  if (agg.stats.total < 7) {
    return {
      message: "Data is building — continue logging responses for clearer insights.",
      level: "medium",
    };
  }

  return {
    message: "Decision pattern data is solid.",
    level: "high",
  };
}

/**
 * Describe a pull-back or ignore pattern with gentle suggestions.
 * Used when modified/ignored responses are high relative to followed.
 * @param {object} data - Daily data map
 * @returns {string} Brief explanation or empty string if not applicable
 */
export function getModifiedIgnoredNotes(data = {}) {
  const agg = aggregateDecisionResponses(data);

  if (agg.stats.total === 0) return "";

  const modified = agg.stats.modified;
  const ignored = agg.stats.ignored;
  const followed = agg.stats.followed;

  // If mostly followed, no need for this
  if (followed >= modified + ignored) return "";

  const total = followed + modified + ignored;
  const adjustmentRate = (modified + ignored) / total;

  // High adjustment rate — athlete is training to their own plan more than recommendations
  if (adjustmentRate > 0.6) {
    return `You're customizing decisions frequently. That's fine — listen to your body and adjust as needed.`;
  }

  // Balanced adjustment
  if (adjustmentRate > 0.4) {
    return `You adapt recommendations based on how you feel. Make sure you're increasing load gradually.`;
  }

  return "";
}

/**
 * Build a structured weekly feedback object for the Progress tab's coach review.
 * Includes decision stats, adherence, and next-step messaging.
 * @param {object} data - Daily data map
 * @param {string} weekEndKey - Optional week end date (YYYY-MM-DD)
 * @returns {object} Feedback summary with stats and messaging
 */
export function buildDecisionFeedbackWeekly(data = {}, weekEndKey = null) {
  // Get the week's span
  const endDate = weekEndKey ? new Date(`${weekEndKey}T12:00:00`) : new Date();
  const weekKeys = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(endDate.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    weekKeys.push(key);
  }

  // Collect this week's responses
  const weekResponses = [];
  for (const key of weekKeys) {
    const resp = data[key]?.intelligence?.todayDecisionResponse;
    if (resp && resp.response) {
      weekResponses.push(resp.response);
    }
  }

  // Calculate stats
  const stats = {
    followed: weekResponses.filter(r => r === "followed").length,
    modified: weekResponses.filter(r => r === "modified").length,
    ignored: weekResponses.filter(r => r === "ignored").length,
    skipped: weekResponses.filter(r => r === "skipped").length,
    total: weekResponses.length,
  };

  // Adherence = followed + modified (engaged with the call somehow)
  const adherence = stats.total > 0 ? (stats.followed + stats.modified) / stats.total : 0;

  // Messaging
  let message = "";
  let tone = "neutral";

  if (stats.total === 0) {
    message = "No decision responses logged this week. Tap the decision to feedback your choice.";
    tone = "info";
  } else if (stats.followed >= stats.ignored + stats.modified) {
    message = `Strong adherence: you followed recommendations ${stats.followed} times.`;
    tone = "positive";
  } else if (stats.modified > stats.ignored && stats.modified > stats.followed) {
    message = `You customized recommendations ${stats.modified} times — adapt as needed.`;
    tone = "neutral";
  } else if (stats.ignored > stats.followed + stats.modified) {
    message = `You skipped recommendations ${stats.ignored} times — consider why, and adjust if there's a mismatch.`;
    tone = "caution";
  }

  return {
    stats,
    adherence: Math.round(adherence * 100),
    message,
    tone,
    confidence: stats.total >= 5 ? "high" : stats.total >= 2 ? "medium" : "low",
  };
}
