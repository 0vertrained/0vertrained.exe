// V16.5 · Provenance contracts: the sentence at the verdict must be honest
// about cause — "no data" only for a wholly absent day, "no <metric> reading"
// for partial — and must bridge, not dead-end, on insufficient days.
import { describe, expect, it } from "vitest";
import { buildSignalProvenance } from "../wearables/signalProvenance";

const DAY = "2026-07-14"; const PRIOR = "2026-07-13";
const recFB = (basis = "3/4 signals (rhr+sleep+temp) · normalized") => ({
  score: 78, band: "good_to_train", scoredDay: DAY, scoringBasis: basis,
  ledger: [
    { key: "hrv", counted: true, source: "whoop recovery HRV (fallback)" },
    { key: "rhr", counted: true, source: "raw sleep RHR" },
    { key: "sleep", counted: true, source: "oura staging" },
    { key: "temp", counted: false, source: "missing" },
  ],
});

describe("signal provenance", () => {
  it("wholly absent Oura day → 'had no data', scored on Whoop", () => {
    const note = buildSignalProvenance(recFB(), { [PRIOR]: {} }, { [DAY]: { recovery: {} } }, DAY);
    expect(note).toContain("Oura had no data last night");
    expect(note).toContain("HRV scored on Whoop");
    expect(note).toContain("3/4 signals");
  });

  it("Oura day present but field missing → names the reading, never infers behavior", () => {
    const note = buildSignalProvenance(recFB(), { [DAY]: { sleep: {} }, [PRIOR]: {} }, { [DAY]: { recovery: {} } }, DAY);
    expect(note).toContain("Oura had no HRV reading last night");
    expect(note).not.toContain("had no data");
  });

  it("insufficient day bridges to the manual check-in and names pending syncs", () => {
    const rec = { score: null, band: "insufficient_data", scoredDay: DAY, ledger: [] };
    const note = buildSignalProvenance(rec, { [PRIOR]: {} }, { [PRIOR]: { recovery: {} } }, DAY);
    expect(note).toContain("Log this morning's check-in");
    expect(note).toContain("Oura and Whoop haven't reported today yet");
  });

  it("Whoop silent while Oura carried the day → sync-race note only", () => {
    const rec = { ...recFB("4/4 signals · normalized"), ledger: recFB().ledger.map(l => ({ ...l, source: l.source.replace(" (fallback)", ""), counted: true })) };
    const note = buildSignalProvenance(rec, { [DAY]: {}, [PRIOR]: {} }, { [PRIOR]: { recovery: {} } }, DAY);
    expect(note).toContain("Whoop hasn't reported today yet");
    expect(note).not.toContain("scored on Whoop");
  });

  it("full 4/4 with both devices present → silence", () => {
    const rec = { ...recFB("4/4 signals · normalized"), ledger: recFB().ledger.map(l => ({ ...l, source: "raw", counted: true })) };
    expect(buildSignalProvenance(rec, { [DAY]: {} }, { [DAY]: { recovery: {} } }, DAY)).toBeNull();
  });
});
