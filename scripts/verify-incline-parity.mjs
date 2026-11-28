import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { inclineReplayVectors } from "./fixtures/incline-replay.mjs";
import { simulateIncline } from "../src/climb/offlineIncline.js";

const native = process.argv[2];
if (!native) throw new Error("Pass the compiled Swift incline replay fixture executable.");
for (const {name, events, cap, simulateAcknowledgements} of inclineReplayVectors) {
  const expected = simulateIncline(events, cap, simulateAcknowledgements);
  const actual = spawnSync(native, ["--replay-stdin"], {
    input:JSON.stringify({events,cap,simulateAcknowledgements}), encoding:"utf8",
  });
  assert.equal(actual.status, 0, name + ": " + (actual.error?.message || actual.stderr));
  assert.deepStrictEqual(JSON.parse(actual.stdout), expected, name);
}
console.log(`Native and browser incline replay agreed on every row in ${inclineReplayVectors.length} timelines.`);
