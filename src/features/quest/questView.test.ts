import { describe, expect, it } from "vitest";
import { seed } from "../../data/demo/seed";
import { buildProgress } from "../../domain/game/progress";
import { metaFor as libraryMeta } from "../../domain/program/library";
import { metaFor, threeDayProgram } from "../../test/gameFixtures";
import { scenario } from "../../test/gameScenario";
import { questView } from "./questView";

const TODAY = "2026-10-07";

describe("questView", () => {
  it("reads the demo's reduced, untouched day", () => {
    const s = seed(TODAY);
    const progress = buildProgress({ days: s.days, program: s.program, settings: s.settings, todayKey: TODAY, metaFor: (log) => libraryMeta(log.libraryId ?? log.name) });
    const v = questView({ progress, todayKey: TODAY, day: s.days[TODAY], days: s.days, program: s.program });
    expect(v.tier).toBe("REDUCED");
    expect(v.issued).toBe(true);
    expect(v.reason).toMatch(/^Slept poorly \+ very sore: Reduced quest/);
    expect(v.action).toEqual({ key: "begin", label: "Begin quest", primary: true });
    expect(v.objectives.map((o) => [o.key, o.state])).toEqual([["checkin", "done"], ["training", "not-started"], ["cardio", "not-started"]]);
    expect(v.objectives[1]).toMatchObject({ sublabel: "Full Body C", progress: { done: 0, total: 10, unit: "sets" }, xp: 90 });
    expect(v.potentialXp).toBe(100);
    expect(v.days).toHaveLength(7);
    expect(v.days.find((d) => d.today)?.state).toBe("open");
    expect(v.weekly?.progress).toMatch(/^\d\/3 cleared$/);
    expect(v.notice?.tag).toBe("RANK TRIAL");
    expect(v.allowanceLeft).toBe(13);
  });

  it("synthesises today's quest before a check-in and asks for one first", () => {
    const s = scenario({ program: threeDayProgram(), startedOn: "2026-09-28", todayKey: TODAY, noCheckinOn: [TODAY], todayUntouched: true });
    delete s.days[TODAY];
    const progress = buildProgress({ days: s.days, program: s.program, settings: s.settings, todayKey: TODAY, metaFor });
    const v = questView({ progress, todayKey: TODAY, day: undefined, days: s.days, program: s.program });
    expect(v.issued).toBe(false);
    expect(v.tier).toBe("FULL");
    expect(v.action.key).toBe("checkin");
    expect(v.objectives[0]).toMatchObject({ key: "checkin", state: "not-started", xp: 10 });
    expect(v.objectives[1]).toMatchObject({ key: "training", xp: 120 });
  });

  it("asks nothing more on an illness day", () => {
    const s = scenario({ program: threeDayProgram(), startedOn: "2026-09-28", todayKey: TODAY, illnessOn: [TODAY], todayUntouched: true });
    const progress = buildProgress({ days: s.days, program: s.program, settings: s.settings, todayKey: TODAY, metaFor });
    const v = questView({ progress, todayKey: TODAY, day: s.days[TODAY], days: s.days, program: s.program });
    expect(v.action.key).toBe("none");
    expect(v.objectives).toEqual([{ key: "checkin", label: "Status check", state: "done", xp: 10 }]);
    expect(v.potentialXp).toBe(10);
    expect(v.days.find((d) => d.today)?.state).toBe("protected");
  });

  it("shows a rest day's recovery objective and notice", () => {
    const sunday = "2026-10-04";
    const s = scenario({ program: threeDayProgram(), startedOn: "2026-09-28", todayKey: sunday, todayUntouched: true });
    const progress = buildProgress({ days: s.days, program: s.program, settings: s.settings, todayKey: sunday, metaFor });
    const v = questView({ progress, todayKey: sunday, day: s.days[sunday], days: s.days, program: s.program });
    expect(v.tier).toBe("REST");
    expect(v.objectives.map((o) => o.key)).toEqual(["checkin", "recovery"]);
    expect(v.objectives[1]).toMatchObject({ xp: 20, state: "not-started" });
    expect(v.notice).toEqual({ tag: "REST", text: "Rest day. Recovery done pays in full." });
    expect(v.days.filter((d) => d.state === "kept")).toHaveLength(3);
  });
});
