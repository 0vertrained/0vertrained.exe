// @vitest-environment node
// src/__tests__/pushReminderSchedule.test.js
// V12.1 · The reminder cron now fires hourly and sends only to subscriptions
// whose LOCAL time is in the 19:00–19:59 window, using the tz offset captured
// at subscribe time (Date#getTimezoneOffset semantics: minutes to ADD to
// local time to reach UTC). These tests pin the isDue window math.
import { describe, it, expect } from "vitest";
import { isDue } from "../../netlify/functions/push-reminders.js";

// Helper: UTC ms for a given hour:minute on a fixed date.
const utc = (h, m = 30) => Date.UTC(2026, 6, 3, h, m, 0);

describe("push reminder isDue", () => {
  it("US Central (offset 360, UTC-6): due at 01:30 UTC (= 19:30 local)", () => {
    expect(isDue(360, utc(1))).toBe(true);
    expect(isDue(360, utc(0))).toBe(false);  // 18:30 local — not yet
    expect(isDue(360, utc(2))).toBe(false);  // 20:30 local — window passed
  });

  it("UTC (offset 0): due at 19:30 UTC exactly", () => {
    expect(isDue(0, utc(19))).toBe(true);
    expect(isDue(0, utc(18))).toBe(false);
    expect(isDue(0, utc(20))).toBe(false);
  });

  it("UTC+2 (offset -120, e.g. Central Europe summer): due at 17:30 UTC", () => {
    expect(isDue(-120, utc(17))).toBe(true);
    expect(isDue(-120, utc(19))).toBe(false);
  });

  it("half-hour zone India UTC+5:30 (offset -330): lands in the 19:00–19:59 local window", () => {
    // 14:30 UTC → 20:00 IST (just missed); 13:30 UTC → 19:00 IST (due).
    expect(isDue(-330, utc(13))).toBe(true);
    expect(isDue(-330, utc(14))).toBe(false);
  });

  it("legacy rows (missing/garbage offset) default to Central — old behavior preserved", () => {
    expect(isDue(undefined, utc(1))).toBe(true);
    expect(isDue(null, utc(1))).toBe(true);
    expect(isDue("not-a-number", utc(1))).toBe(true);
    expect(isDue(undefined, utc(19))).toBe(false); // NOT the UTC window
  });

  it("exactly one due window per subscription per day across all 24 hourly runs", () => {
    for (const offset of [360, 0, -120, -330, 840, -840]) {
      let dueCount = 0;
      for (let h = 0; h < 24; h++) if (isDue(offset, utc(h))) dueCount++;
      expect(dueCount).toBe(1);
    }
  });
});
