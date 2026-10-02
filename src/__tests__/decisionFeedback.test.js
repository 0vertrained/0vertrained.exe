import { describe, expect, it } from "vitest";
import {
  aggregateDecisionResponses,
  getDecisionFeedbackBrief,
  getDecisionDataQuality,
  getModifiedIgnoredNotes,
  buildDecisionFeedbackWeekly,
} from "../decisionFeedback";

describe("aggregateDecisionResponses", () => {
  it("returns empty stats for no data", () => {
    const result = aggregateDecisionResponses({});
    expect(result.stats.total).toBe(0);
    expect(result.adherence).toBe(0);
    expect(result.confidence).toBe("low");
  });

  it("counts all response types", () => {
    const data = {
      "2024-01-01": {
        intelligence: {
          todayDecisionResponse: { decisionCall: "push", response: "followed" },
        },
      },
      "2024-01-02": {
        intelligence: {
          todayDecisionResponse: { decisionCall: "moderate", response: "modified" },
        },
      },
      "2024-01-03": {
        intelligence: {
          todayDecisionResponse: { decisionCall: "normal", response: "ignored" },
        },
      },
      "2024-01-04": {
        intelligence: {
          todayDecisionResponse: { decisionCall: "rest", response: "skipped" },
        },
      },
    };
    const result = aggregateDecisionResponses(data);
    expect(result.stats.followed).toBe(1);
    expect(result.stats.modified).toBe(1);
    expect(result.stats.ignored).toBe(1);
    expect(result.stats.skipped).toBe(1);
    expect(result.stats.total).toBe(4);
  });

  it("calculates adherence correctly", () => {
    const data = {
      "2024-01-01": {
        intelligence: {
          todayDecisionResponse: { response: "followed" },
        },
      },
      "2024-01-02": {
        intelligence: {
          todayDecisionResponse: { response: "followed" },
        },
      },
      "2024-01-03": {
        intelligence: {
          todayDecisionResponse: { response: "ignored" },
        },
      },
    };
    const result = aggregateDecisionResponses(data);
    expect(result.adherence).toBeCloseTo(2 / 3);
  });

  it("calculates implementation rate from followed vs engaged", () => {
    const data = {
      "2024-01-01": {
        intelligence: {
          todayDecisionResponse: { response: "followed" },
        },
      },
      "2024-01-02": {
        intelligence: {
          todayDecisionResponse: { response: "modified" },
        },
      },
      "2024-01-03": {
        intelligence: {
          todayDecisionResponse: { response: "modified" },
        },
      },
    };
    const result = aggregateDecisionResponses(data);
    expect(result.implementation).toBeCloseTo(1 / 3); // 1 followed out of 3 engaged
  });

  it("sets confidence based on entry count", () => {
    let result = aggregateDecisionResponses({
      "2024-01-01": {
        intelligence: { todayDecisionResponse: { response: "followed" } },
      },
    });
    expect(result.confidence).toBe("low");

    result = aggregateDecisionResponses(
      Array.from({ length: 5 }, (_, i) => ({
        [`2024-01-${String(i + 1).padStart(2, "0")}`]: {
          intelligence: { todayDecisionResponse: { response: "followed" } },
        },
      })).reduce((a, b) => ({ ...a, ...b }), {})
    );
    expect(result.confidence).toBe("medium");

    result = aggregateDecisionResponses(
      Array.from({ length: 10 }, (_, i) => ({
        [`2024-01-${String(i + 1).padStart(2, "0")}`]: {
          intelligence: { todayDecisionResponse: { response: "followed" } },
        },
      })).reduce((a, b) => ({ ...a, ...b }), {})
    );
    expect(result.confidence).toBe("high");
  });

  it("tracks call breakdown", () => {
    const data = {
      "2024-01-01": {
        intelligence: {
          todayDecisionResponse: { decisionCall: "push", response: "followed" },
        },
      },
      "2024-01-02": {
        intelligence: {
          todayDecisionResponse: { decisionCall: "push", response: "modified" },
        },
      },
      "2024-01-03": {
        intelligence: {
          todayDecisionResponse: { decisionCall: "rest", response: "ignored" },
        },
      },
    };
    const result = aggregateDecisionResponses(data);
    expect(result.callBreakdown.push).toBe(2);
    expect(result.callBreakdown.rest).toBe(1);
  });

  it("respects maxDays limit", () => {
    const data = {};
    for (let i = 0; i < 20; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      data[key] = {
        intelligence: { todayDecisionResponse: { response: "followed" } },
      };
    }
    const result = aggregateDecisionResponses(data, 10);
    expect(result.entries.length).toBeLessThanOrEqual(10);
  });
});

describe("getDecisionFeedbackBrief", () => {
  it("returns empty string when no data", () => {
    const msg = getDecisionFeedbackBrief({});
    expect(msg).toBe("");
  });

  it("returns empty string with minimal data", () => {
    const msg = getDecisionFeedbackBrief({
      "2024-01-01": {
        intelligence: { todayDecisionResponse: { response: "followed" } },
      },
    });
    expect(msg).toBe("");
  });

  it("praises high adherence", () => {
    const data = {};
    for (let i = 0; i < 10; i++) {
      data[`2024-01-${String(i + 1).padStart(2, "0")}`] = {
        intelligence: { todayDecisionResponse: { response: "followed" } },
      };
    }
    const msg = getDecisionFeedbackBrief(data);
    expect(msg).toContain("following recommendations");
  });

  it("addresses frequent modification", () => {
    const data = {
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "modified" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "modified" } } },
      "2024-01-03": { intelligence: { todayDecisionResponse: { response: "modified" } } },
      "2024-01-04": { intelligence: { todayDecisionResponse: { response: "modified" } } },
      "2024-01-05": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
    };
    const msg = getDecisionFeedbackBrief(data);
    expect(msg).toContain("customize");
  });

  it("addresses frequent ignoring", () => {
    const data = {
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
      "2024-01-03": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
      "2024-01-04": { intelligence: { todayDecisionResponse: { response: "followed" } } },
    };
    const msg = getDecisionFeedbackBrief(data);
    expect(msg).toContain("not following recommendations");
  });
});

describe("getDecisionDataQuality", () => {
  it("reports low quality when no data", () => {
    const result = getDecisionDataQuality({});
    expect(result.level).toBe("low");
    expect(result.message).toContain("No decision responses");
  });

  it("reports low quality with sparse data", () => {
    const today = new Date();
    const d1 = new Date(today);
    d1.setDate(d1.getDate() - 1);
    const d2 = new Date(today);
    d2.setDate(d2.getDate() - 2);
    const k1 = `${d1.getFullYear()}-${String(d1.getMonth() + 1).padStart(2, "0")}-${String(d1.getDate()).padStart(2, "0")}`;
    const k2 = `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, "0")}-${String(d2.getDate()).padStart(2, "0")}`;

    const data = {
      [k1]: { intelligence: { todayDecisionResponse: { response: "followed" } } },
      [k2]: { intelligence: { todayDecisionResponse: { response: "followed" } } },
    };
    const result = getDecisionDataQuality(data);
    expect(result.level).toBe("low");
    expect(result.message).toContain("sparse");
  });

  it("reports medium quality with moderate data", () => {
    const today = new Date();
    const data = {};
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      data[k] = { intelligence: { todayDecisionResponse: { response: "followed" } } };
    }
    const result = getDecisionDataQuality(data);
    expect(result.level).toBe("medium");
  });

  it("reports high quality with sufficient data", () => {
    const today = new Date();
    const data = {};
    for (let i = 0; i < 10; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      data[k] = { intelligence: { todayDecisionResponse: { response: "followed" } } };
    }
    const result = getDecisionDataQuality(data);
    expect(result.level).toBe("high");
  });
});

describe("getModifiedIgnoredNotes", () => {
  it("returns empty when no data", () => {
    const msg = getModifiedIgnoredNotes({});
    expect(msg).toBe("");
  });

  it("returns empty when mostly followed", () => {
    const data = {
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-03": { intelligence: { todayDecisionResponse: { response: "modified" } } },
    };
    const msg = getModifiedIgnoredNotes(data);
    expect(msg).toBe("");
  });

  it("notes high adjustment rate", () => {
    const data = {
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "modified" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "modified" } } },
      "2024-01-03": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
      "2024-01-04": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
      "2024-01-05": { intelligence: { todayDecisionResponse: { response: "followed" } } },
    };
    const msg = getModifiedIgnoredNotes(data);
    expect(msg).toContain("customizing");
  });

  it("notes balanced adjustment", () => {
    const data = {
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-03": { intelligence: { todayDecisionResponse: { response: "modified" } } },
      "2024-01-04": { intelligence: { todayDecisionResponse: { response: "modified" } } },
      "2024-01-05": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
    };
    const msg = getModifiedIgnoredNotes(data);
    expect(msg).toContain("adapt");
  });
});

describe("buildDecisionFeedbackWeekly", () => {
  it("returns empty stats for no data", () => {
    const result = buildDecisionFeedbackWeekly({}, "2024-01-07");
    expect(result.stats.total).toBe(0);
    expect(result.message).toContain("No decision responses");
  });

  it("aggregates responses for a specific week", () => {
    // Week: Jan 1–7, 2024
    const data = {
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-03": { intelligence: { todayDecisionResponse: { response: "modified" } } },
      "2024-01-08": { intelligence: { todayDecisionResponse: { response: "ignored" } } }, // Next week, ignored
    };
    const result = buildDecisionFeedbackWeekly(data, "2024-01-07");
    expect(result.stats.followed).toBe(2);
    expect(result.stats.modified).toBe(1);
    expect(result.stats.ignored).toBe(0); // Not in this week
    expect(result.stats.total).toBe(3);
  });

  it("calculates adherence for the week", () => {
    const data = {
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "modified" } } },
      "2024-01-03": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
    };
    const result = buildDecisionFeedbackWeekly(data, "2024-01-07");
    expect(result.adherence).toBe(Math.round((2 / 3) * 100));
  });

  it("sets message to positive when mostly followed", () => {
    const data = {
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-03": { intelligence: { todayDecisionResponse: { response: "modified" } } },
    };
    const result = buildDecisionFeedbackWeekly(data, "2024-01-07");
    expect(result.tone).toBe("positive");
    expect(result.message).toContain("Strong adherence");
  });

  it("sets tone to caution when mostly ignored", () => {
    const data = {
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
      "2024-01-03": { intelligence: { todayDecisionResponse: { response: "ignored" } } },
      "2024-01-04": { intelligence: { todayDecisionResponse: { response: "followed" } } },
    };
    const result = buildDecisionFeedbackWeekly(data, "2024-01-07");
    expect(result.tone).toBe("caution");
  });

  it("sets confidence based on response count", () => {
    let result = buildDecisionFeedbackWeekly({
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "followed" } } },
    }, "2024-01-07");
    expect(result.confidence).toBe("low");

    result = buildDecisionFeedbackWeekly({
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "followed" } } },
    }, "2024-01-07");
    expect(result.confidence).toBe("medium");

    result = buildDecisionFeedbackWeekly({
      "2024-01-01": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-02": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-03": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-04": { intelligence: { todayDecisionResponse: { response: "followed" } } },
      "2024-01-05": { intelligence: { todayDecisionResponse: { response: "followed" } } },
    }, "2024-01-07");
    expect(result.confidence).toBe("high");
  });
});
