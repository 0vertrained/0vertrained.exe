import { describe, expect, it } from "vitest";
import { getMovementModule } from "../formCheck/movementRouting";
import { DEFAULT_MOVEMENT } from "../formCheck/protocols";

describe("getMovementModule", () => {
  it("routes the squat protocol key to the squat module", () => {
    const mod = getMovementModule("squat-side-view");
    expect(mod.movement).toBe("squat");
    expect(typeof mod.aggregate).toBe("function");
    expect(typeof mod.buildSeries).toBe("function");
    expect(typeof mod.analyze).toBe("function");
    expect(typeof mod.segment).toBe("function");
  });

  it("routes the deadlift protocol key to the deadlift module", () => {
    const mod = getMovementModule("deadlift-side-view");
    expect(mod.movement).toBe("deadlift");
    const r = mod.analyze({ minHipAngleDeg: 100, maxHipAngleDeg: 172, hipRangeDeg: 72 });
    expect(r.movement).toBe("deadlift");
  });

  it("routes the push-up protocol key to the push-up module", () => {
    const mod = getMovementModule("pushup-side-view");
    expect(mod.movement).toBe("pushup");
    const r = mod.analyze({ minElbowAngleDeg: 90, bodyLineDevDeg: 5 });
    expect(r.movement).toBe("pushup");
  });

  it("routes the bench-press protocol key to the bench-press module", () => {
    const mod = getMovementModule("benchpress-side-view");
    expect(mod.movement).toBe("benchpress");
    expect(typeof mod.aggregate).toBe("function");
    expect(typeof mod.buildSeries).toBe("function");
    expect(typeof mod.segment).toBe("function");
    const r = mod.analyze({ minElbowAngleDeg: 90, maxElbowAngleDeg: 172, elbowRangeDeg: 82 });
    expect(r.movement).toBe("benchpress");
  });

  it("routes the overhead-press protocol key to the overhead-press module", () => {
    const mod = getMovementModule("overheadpress-side-view");
    expect(mod.movement).toBe("overheadpress");
    const r = mod.analyze({ minElbowAngleDeg: 90, maxElbowAngleDeg: 172, elbowRangeDeg: 82 });
    expect(r.movement).toBe("overheadpress");
  });

  it("routes the bent-over-row protocol key to the bent-over-row module", () => {
    const mod = getMovementModule("bentoverrow-side-view");
    expect(mod.movement).toBe("bentoverrow");
    const r = mod.analyze({ minElbowAngleDeg: 80, maxElbowAngleDeg: 170, torsoLeanDeg: 5 });
    expect(r.movement).toBe("bentoverrow");
  });

  it("falls back to the default (squat) module for an unknown key", () => {
    const mod = getMovementModule("does-not-exist");
    const def = getMovementModule(DEFAULT_MOVEMENT);
    expect(mod.movement).toBe(def.movement);
    expect(mod.movement).toBe("squat");
  });

  it("falls back safely for missing/empty input", () => {
    expect(getMovementModule().movement).toBe("squat");
    expect(getMovementModule(null).movement).toBe("squat");
  });
});
