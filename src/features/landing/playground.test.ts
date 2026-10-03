import { describe, expect, it } from "vitest";
import { CHECKIN_ROWS } from "../../domain/readiness/checkin";
import { PLAYGROUND_DEFAULTS, playgroundDecision, playgroundSentence } from "./playground";

describe("landing playground", () => {
  it("starts on the middle taps and reads FULL", () => {
    expect(Object.keys(PLAYGROUND_DEFAULTS).sort()).toEqual(CHECKIN_ROWS.map((r) => r.field).sort());
    const d = playgroundDecision(PLAYGROUND_DEFAULTS);
    expect(d.tier).toBe("FULL");
    expect(playgroundSentence(d)).toBe("Full quest. The whole plan, full XP.");
  });

  it("lowers to REDUCED on two rough answers and names them", () => {
    const d = playgroundDecision({ ...PLAYGROUND_DEFAULTS, sleepQuality: 3, soreness: 8 });
    expect(d.tier).toBe("REDUCED");
    expect(playgroundSentence(d)).toMatch(/^Slept poorly \+ very sore: one set less per lift\. Same XP\.$/);
  });

  it("goes to RECOVER with everything rough, and illness protects the streak", () => {
    expect(playgroundDecision({ sleepQuality: 3, soreness: 8, stress: 8, energy: 3 }).tier).toBe("RECOVER");
    const ill = playgroundDecision(PLAYGROUND_DEFAULTS, true);
    expect(ill.tier).toBe("RECOVER");
    expect(playgroundSentence(ill)).toBe("Ill or injured: rest today. Streak protected.");
  });
});
