// netlify/tests/edition-courier.test.js
// ─────────────────────────────────────────────────────────────────────────────
// V17.3 · The Courier. Pins:
//   (1) the local-clock windows — morning 07:xx and Sunday 17:xx — across
//       whole-hour, half-hour (India +330), and legacy-null offsets;
//   (2) the transition detector matrix — consecutive days only, stale states
//       never manufacture news, calibrating never transitions;
//   (3) the copy doctrine — no digits anywhere in any payload: headlines and
//       actions only, never a bare score;
//   (4) idempotency semantics and prefs plumbing (source guards on the claim
//       order, the fail-closed rule, and the prefs action).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  isMorningDue, isSundayEveningDue, localParts, yesterdayKey,
  detectTransition, editionPayload, transitionPayload, SUNDAY_PAYLOAD, ACTION_SNIPPETS,
} from "../functions/edition-courier.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

// 2026-07-15 12:15 UTC as the reference run.
const at = (iso) => new Date(iso).getTime();

describe("V17.3 windows — the local clock decides", () => {
  it("morning window: 07:xx local across offsets", () => {
    // UTC 13:15 → Central (offset 360) local 07:15 → due.
    expect(isMorningDue(360, at("2026-07-15T13:15:00Z"))).toBe(true);
    // Same instant, UTC device (offset 0) local 13:15 → not due.
    expect(isMorningDue(0, at("2026-07-15T13:15:00Z"))).toBe(false);
    // India (offset -330): local 07:45 at UTC 02:15 → due; half-hour zones land.
    expect(isMorningDue(-330, at("2026-07-15T02:15:00Z"))).toBe(true);
    // Legacy null offset behaves as Central (the push-reminders contract).
    expect(isMorningDue(null, at("2026-07-15T13:15:00Z"))).toBe(true);
    // 06:59 and 08:00 local both miss.
    expect(isMorningDue(360, at("2026-07-15T12:59:00Z"))).toBe(false);
    expect(isMorningDue(360, at("2026-07-15T14:00:00Z"))).toBe(false);
  });

  it("sunday window: Sunday 17:xx local, and only Sunday", () => {
    // 2026-07-12 is a Sunday. Central local 17:15 = UTC 23:15.
    expect(isSundayEveningDue(360, at("2026-07-12T23:15:00Z"))).toBe(true);
    // Same local hour on Monday → no.
    expect(isSundayEveningDue(360, at("2026-07-13T23:15:00Z"))).toBe(false);
    // Sunday 16:xx local → no.
    expect(isSundayEveningDue(360, at("2026-07-12T22:15:00Z"))).toBe(false);
    // A UTC device at Sunday 23:15 local-UTC is still Sunday 23h → no (17 only).
    expect(isSundayEveningDue(0, at("2026-07-12T23:15:00Z"))).toBe(false);
  });

  it("localParts dates roll correctly across midnight", () => {
    // UTC 2026-07-16 01:15, Central local = 07-15 19:15.
    expect(localParts(360, at("2026-07-16T01:15:00Z")).dateKey).toBe("2026-07-15");
    expect(yesterdayKey("2026-07-15")).toBe("2026-07-14");
    expect(yesterdayKey("2026-07-01")).toBe("2026-06-30");
  });
});

describe("V17.3 transition detector — consecutive days only", () => {
  const today = { stateKey: "fresh", stateName: "Fresh" };

  it("fires on a genuine day-over-day change", () => {
    const t = detectTransition({ state_key: "steady", state_date: "2026-07-14" }, today, "2026-07-15");
    expect(t).toEqual({ from: "Steady", to: "Fresh" });
  });

  it("stale states never manufacture news; same-state and missing are silent", () => {
    expect(detectTransition({ state_key: "steady", state_date: "2026-07-12" }, today, "2026-07-15")).toBe(null);
    expect(detectTransition({ state_key: "fresh", state_date: "2026-07-14" }, today, "2026-07-15")).toBe(null);
    expect(detectTransition(null, today, "2026-07-15")).toBe(null);
    expect(detectTransition({}, today, "2026-07-15")).toBe(null);
  });

  it("calibrating transitions are never news, in either direction", () => {
    expect(detectTransition({ state_key: "calibrating", state_date: "2026-07-14" }, today, "2026-07-15")).toBe(null);
    expect(detectTransition({ state_key: "steady", state_date: "2026-07-14" }, { stateKey: "calibrating", stateName: "Calibrating" }, "2026-07-15")).toBe(null);
  });
});

describe("V17.3 copy doctrine — headlines, never numbers", () => {
  it("no payload contains a digit anywhere", () => {
    const payloads = [
      editionPayload({ stateKey: "fresh", stateName: "Fresh" }),
      editionPayload({ stateKey: "steady", stateName: "Steady" }),
      editionPayload({ stateKey: "accumulating", stateName: "Accumulating fatigue" }),
      editionPayload({ stateKey: "deload", stateName: "Deload advised" }),
      transitionPayload("Steady", { stateKey: "fresh", stateName: "Fresh" }),
      SUNDAY_PAYLOAD,
    ];
    for (const p of payloads) {
      expect(`${p.title} ${p.body}`).not.toMatch(/\d/);
      expect(p.url).toContain("Recovery");
    }
    for (const snippet of Object.values(ACTION_SNIPPETS)) expect(snippet).not.toMatch(/\d/);
  });

  it("every edition body pairs the state with its action clause", () => {
    const p = editionPayload({ stateKey: "accumulating", stateName: "Accumulating fatigue" });
    expect(p.body).toBe("Accumulating fatigue. Favor the lower end of volume today.");
  });
});

describe("V17.3 courier discipline (source guards)", () => {
  const src = read("netlify/functions/edition-courier.js");

  it("idempotency is claimed BEFORE any send, and claims fail closed", () => {
    expect(src.indexOf("await claim(")).toBeLessThan(src.indexOf("send(d, payload)"));
    expect(src).toContain("resolution=ignore-duplicates");
    expect(src).toContain("if (!r.ok) return false; // table missing or error → do not send blind");
  });

  it("the data-ready gate skips silently and calibrating never pushes", () => {
    expect(src).toContain("if (!todaySleep) { tally.skippedNoData++; continue; }");
    expect(src).toContain('if (state.stateKey === "calibrating") continue;');
  });

  it("push_state records today's truth even when nothing is sent", () => {
    const stateWrite = src.indexOf('rest("push_state?on_conflict=user_id"');
    const editionSend = src.indexOf('claim(userId, dateKey, "edition"');
    expect(stateWrite).toBeGreaterThan(-1);
    expect(stateWrite).toBeLessThan(editionSend);
  });

  it("prune-on-410 and the hourly :15 schedule follow the house pattern", () => {
    expect(src).toContain("code === 404 || code === 410");
    expect(src).toContain('schedule: "15 * * * *"');
  });

  it("prefs plumbing: the subscribe function patches per-user, the card offers both switches", () => {
    const sub = read("netlify/functions/push-subscribe.js");
    expect(sub).toContain('action === "prefs"');
    expect(sub).toMatch(/PATCH/);
    const card = read("src/NotificationsCard.jsx");
    expect(card).toContain('data-testid="courier-prefs"');
    expect(card).toContain("edition_enabled");
    expect(card).toContain("transitions_enabled");
    expect(read("src/push.js")).toContain("export async function setPushPrefs");
  });
});
