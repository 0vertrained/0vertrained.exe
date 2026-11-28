// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildCourse, courseDistances, importGpx, preserveRehearsal } from "../rehearsal/course";
import { rehearsalAttempt } from "../rehearsal/attempts";
import { applyWatchEvents, buildWatchWeek } from "../watch/watchPlan";

const date = "2026-11-27";
const points = [{ lat: 0, lon: 0 }, { lat: 0, lon: .01 }, { lat: 0, lon: 0 }];
const water = { id: "water1", name: "Water", kind: "water", pointIndex: 1, targetSeconds: 300, instruction: "Refill" };
const source = { id: "loop", date, name: "Out and back", points, checkpoints: [water] };
const run = { type: "rehearsal", owner: "athlete", date, id: "attempt-1", courseId: "loop", name: "Out and back", startedAt: date + "T12:00:00Z",
  endedAt: date + "T12:07:00Z", distanceMeters: 1120, marks: [{ checkpointId: "water1", kind: "water", name: "Water", meters: 1112, targetSeconds: 300, elapsedSeconds: 310, departedSeconds: 322, status: "taken" }] };

describe("mapped rehearsal and phone–watch contract", () => {
  it("measures the full out-and-back, puts the finish last, and preserves an independent course on a preset switch", () => {
    const course = buildCourse(source);
    expect(course.distanceMeters).toBeCloseTo(2223.9, 0);
    expect(course.checkpoints.map(c => [c.kind, c.pointIndex])).toEqual([["water", 1], ["finish", 2]]);
    expect(buildCourse(course)).toEqual(course);
    expect(preserveRehearsal({ __rehearsal: course }, { Fri: {} }).__rehearsal).toEqual(course);
    expect(preserveRehearsal({ __rehearsal: course }, { __rehearsal: null }).__rehearsal).toBeNull();
    expect(courseDistances([{ lat: 0, lon: 179.99 }, { lat: 0, lon: -179.99 }])[1]).toBeCloseTo(2223.9, 0);
  });
  it("rejects impossible dates, coordinates, checkpoint indices and misplaced finish or time targets", () => {
    for (const edit of [{ date: "2026-02-30" }, { points: [{ lat: null, lon: 0 }, points[1]] }, { id: "__proto__" }, { checkpoints: [{ ...water, pointIndex: 3 }] },
      { checkpoints: [{ ...water, kind: "finish" }] }, { checkpoints: [water, { ...water, id: "water2", pointIndex: 2, targetSeconds: 240 }] }]) {
      expect(() => buildCourse({ ...source, ...edit })).toThrow();
    }
  });
  it("imports namespaced GPX and preserves a named checkpoint and last point when simplifying", () => {
    const track = Array.from({ length: 801 }, (_, i) => '<trkpt lat="40" lon="' + (-105 + i / 100000) + '"/>').join("");
    const xml = '<gpx xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="40" lon="-104.99487"><name>Creek &amp; aid</name><type>aid</type></wpt><trk><name>Creek loop</name><trkseg>' + track + '</trkseg></trk></gpx>';
    const { name, points: line, checkpoints } = importGpx(xml);
    expect(name).toBe("Creek loop");
    expect(line).toHaveLength(450);
    expect(line.at(-1).lon).toBe(-104.992);
    expect(checkpoints[0].name).toBe("Creek & aid");
    expect(line[checkpoints[0].pointIndex].lon).toBe(-104.99487);
    expect(checkpoints.at(-1).kind).toBe("finish");
  });
  it("supports GPX routes, rejects disconnected tracks and unsafe or broken XML", () => {
    const rte = '<rte><rtept lat="45" lon="2"/><rtept lat="45" lon="2.01"><name>Aid</name></rtept></rte>';
    expect(importGpx("<gpx>" + rte + "</gpx>").checkpoints[0].name).toBe("Aid");
    for (const src of ["<!DOCTYPE gpx><gpx/>", "<gpx><trk><trkseg/><trkseg/></trk></gpx>", "<gpx>" + rte + rte + "</gpx>", "<gpx><rte>"]) expect(() => importGpx(src)).toThrow();
  });
  it("pins a GPX aid station to the middle of a sparse leg", () => {
    const xml = '<gpx><wpt lat="0.0001" lon="0.015"><name>Creek</name><type>aid</type></wpt><rte><rtept lat="0" lon="0"/><rtept lat="0" lon="0.03"/></rte></gpx>';
    const route = importGpx(xml);
    expect(route.points).toHaveLength(3);
    expect(route.points[route.checkpoints[0].pointIndex]).toEqual({ lat: 0, lon: .015 });
    expect(route.checkpoints[0].meters).toBeCloseTo(1667.9, 0);
  });
  it("sends the course only for its scheduled day, even with a replaced or corrupt plan", () => {
    const week = buildWatchWeek({ todayKey: "2026-11-26", owner: "athlete", program: { __rehearsal: source } });
    expect(week.rehearsal).toBeUndefined();
    expect(week.days.filter(day => day.rehearsal).map(day => [day.date, day.rehearsal.id])).toEqual([[date, "loop"]]);
    expect(buildWatchWeek({ todayKey: date, program: { __rehearsal: { ...source, points: [] } } }).rehearsal).toBeUndefined();
  });
  it("saves an offline rehearsal once, survives a replaced course and ignores other owners", () => {
    const apply = (events, data = {}) => applyWatchEvents({ owner: "athlete", events, data, currentDateKey: date });
    const result = apply([run, run, { ...run, owner: null, id: "anonymous" }, { ...run, owner: "other", id: "other" }]);
    expect(result.writes.map(x => x.path)).toEqual(["workout.raceRehearsals.attempt-1"]);
    expect(result.writes[0].value.marks[0].departedSeconds).toBe(322);
    expect(result.processed).not.toContain("other");
    expect(result.processed).not.toContain("anonymous");
    expect(apply([run], result.days).writes).toEqual([]);
    expect(rehearsalAttempt({ ...run, marks: [{ ...run.marks[0], departedSeconds: 901 }] })).toBeNull();
  });
});
