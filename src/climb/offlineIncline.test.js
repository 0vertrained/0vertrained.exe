import { expect, it } from "vitest";
import { inclineReplayVectors } from "../../scripts/fixtures/incline-replay.mjs";
import { simulateIncline } from "./offlineIncline";

for (const fixture of inclineReplayVectors) {
  it(fixture.name, () => {
    const { version, rows } = simulateIncline(fixture.events, fixture.cap, fixture.simulateAcknowledgements);
    expect(version).toBe(1);
    expect(rows).toHaveLength(fixture.events.length);
    expect(rows.filter(row => row.command === "incline").map(row => row.commandGrade)).toEqual(fixture.commands);
    expect(rows.at(-1).stage).toBe(fixture.stage);
    if (fixture.reason) expect(rows.at(-1).reason).toContain(fixture.reason);
    if (fixture.stage === "manual") expect(rows.at(-1)).not.toHaveProperty("desiredGrade");
  });
}

it("never synthesizes a measured incline when a virtual command is acknowledged", () => {
  const trace = simulateIncline(inclineReplayVectors[0].events,10);
  expect(trace.rows.find(row => row.command === "incline")).toMatchObject({
    stage:"settling", commandGrade:2, targetGrade:2, desiredGrade:8, measuredGrade:0,
  });
});

it("rejects oversized, malformed and reordered timelines", () => {
  expect(() => simulateIncline(Array(60_001),10)).toThrow();
  expect(() => simulateIncline([],Infinity)).toThrow();
  for (const event of [
    {at:0,type:"ack",opcode:5,ok:true}, {at:0,type:"target",grade:3,sequence:1.2},
    {at:0,type:"timezone"}, {at:0,type:"telemetry"}, {at:0,type:"telemetry",speedMps:-1},
    {at:0,type:"console",grade:NaN}, {at:0,type:"telemetry",inclinePercent:102}, {at:-0.01,type:"tick"},
  ]) expect(() => simulateIncline([event], 8)).toThrow();
  expect(() => simulateIncline([{at:1,type:"tick"},{at:0,type:"arm"}],10)).toThrow();
});
