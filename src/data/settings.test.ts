// The settings document: anything stored opens as usable settings, and a
// patch changes only what it names.
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings, patchSettings, type SettingsV2 } from "./settings";

describe("normalizeSettings", () => {
  it("returns the defaults for anything that is not an object", () => {
    for (const raw of [undefined, null, "settings", 42, true, [], () => 1]) {
      expect(normalizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("returns a fresh object each time, never the shared defaults", () => {
    const a = normalizeSettings(undefined);
    const b = normalizeSettings(undefined);
    expect(a).not.toBe(b);
    expect(a.session).not.toBe(b.session);
    expect(a.session).not.toBe(DEFAULT_SETTINGS.session);
    a.session.restSeconds = 1;
    expect(b.session.restSeconds).toBe(90);
  });

  it.each<[string, unknown, Partial<SettingsV2>]>([
    ["keeps a known unit system", { units: "imperial" }, { units: "imperial" }],
    ["falls back from an unknown unit system", { units: "lbs" }, {}],
    ["keeps a plausible bodyweight", { bodyweightKg: 82.5 }, { bodyweightKg: 82.5 }],
    ["drops a bodyweight given as text", { bodyweightKg: "80" }, {}],
    ["drops a bodyweight that is not positive", { bodyweightKg: 0 }, {}],
    ["drops a bodyweight that is not finite", { bodyweightKg: Number.POSITIVE_INFINITY }, {}],
    ["drops a bodyweight beyond the plausible range", { bodyweightKg: 1200 }, {}],
    ["keeps onboarded only when it is literally true", { onboarded: true }, { onboarded: true }],
    ["treats a truthy non-boolean onboarded as false", { onboarded: "yes" }, {}],
    ["trims the profile strings", { profile: { name: "  Ana  ", featuredTitle: "Initiate" } }, { profile: { name: "Ana", featuredTitle: "Initiate" } }],
    ["drops blank or non-string profile fields", { profile: { name: "", featuredTitle: 7 } }, {}],
    ["ignores a profile that is not an object", { profile: "Ana" }, {}],
    ["rounds the rest and keeps the booleans given", { session: { restSeconds: 120.4, sound: false } }, { session: { restSeconds: 120, sound: false, haptics: true, cues: true } }],
    ["falls back from out-of-range or non-boolean session values", { session: { restSeconds: -5, haptics: 0, cues: "no" } }, {}],
    ["falls back from a rest longer than an hour", { session: { restSeconds: 99_999 } }, {}],
    ["ignores a session that is not an object", { session: null }, {}],
    [
      "keeps valid game settings",
      { game: { title: "Initiate", bodyweightKg: 80, startedOn: "2026-08-01", importedThrough: "2026-07-31" } },
      { game: { title: "Initiate", bodyweightKg: 80, startedOn: "2026-08-01", importedThrough: "2026-07-31" } },
    ],
    ["keeps explicit nulls for the game title and bodyweight", { game: { title: null, bodyweightKg: null } }, { game: { title: null, bodyweightKg: null } }],
    ["drops invalid game values and unknown keys", { game: { title: 5, startedOn: "2026-02-30", importedThrough: "yesterday", extra: 1 } }, {}],
    [
      "keeps only well-formed pauses",
      { game: { pauses: [{ from: "2026-09-01", to: "2026-09-03", reason: "travel" }, { from: "x", to: "y", reason: "sick" }, { from: "2026-09-05", to: "2026-09-06", reason: "bored" }, null] } },
      { game: { pauses: [{ from: "2026-09-01", to: "2026-09-03", reason: "travel" }] } },
    ],
    [
      "keeps only valid high-water marks and de-duplicates achievements",
      { game: { high: { rank: "C", trialsPassed: [{ rank: "D", date: "2026-09-01" }, { rank: "Z", date: "2026-09-01" }, { rank: "C", date: "nope" }], achievements: ["a", "a", "", 3] } } },
      { game: { high: { rank: "C", trialsPassed: [{ rank: "D", date: "2026-09-01" }], achievements: ["a"] } } },
    ],
    ["drops a high with nothing valid in it", { game: { high: { rank: "Z" } } }, {}],
    ["ignores a game that is not an object", { game: "x" }, {}],
    ["forces the version and ignores unknown top-level keys", { v: 1, units: "imperial", unknownKey: true }, { units: "imperial" }],
  ])("%s", (_name, raw, expected) => {
    expect(normalizeSettings(raw)).toEqual({ ...DEFAULT_SETTINGS, ...expected });
  });

  it("omits an optional field rather than storing undefined", () => {
    expect("bodyweightKg" in normalizeSettings({ bodyweightKg: "80" })).toBe(false);
    expect("name" in normalizeSettings({ profile: { name: 1 } }).profile).toBe(false);
    expect("high" in normalizeSettings({ game: { high: {} } }).game).toBe(false);
  });

  it("round-trips a full document unchanged", () => {
    const full: SettingsV2 = {
      v: 2,
      units: "imperial",
      bodyweightKg: 82.5,
      onboarded: true,
      profile: { name: "Ana", featuredTitle: "Initiate" },
      session: { restSeconds: 120, sound: false, haptics: true, cues: false },
      game: { title: "Initiate", bodyweightKg: 82.5, startedOn: "2026-08-01", pauses: [{ from: "2026-09-01", to: "2026-09-02", reason: "sick" }], high: { rank: "D", trialsPassed: [{ rank: "D", date: "2026-09-10" }], achievements: ["first-quest"] } },
    };
    expect(normalizeSettings(JSON.parse(JSON.stringify(full)))).toEqual(full);
  });
});

describe("patchSettings", () => {
  const base = (): SettingsV2 => ({
    v: 2,
    units: "metric",
    bodyweightKg: 80,
    onboarded: true,
    profile: { name: "Ana", featuredTitle: "Initiate" },
    session: { restSeconds: 90, sound: true, haptics: true, cues: true },
    game: { title: "Initiate", startedOn: "2026-08-01", pauses: [{ from: "2026-09-01", to: "2026-09-02", reason: "sick" }], high: { rank: "D", achievements: ["a"] } },
  });

  it("returns a new object and leaves the input untouched", () => {
    const current = base();
    const before = JSON.stringify(current);
    const next = patchSettings(current, { units: "imperial", profile: { name: "Bo" } });
    expect(next).not.toBe(current);
    expect(next.profile).not.toBe(current.profile);
    expect(JSON.stringify(current)).toBe(before);
  });

  it("replaces top-level scalars", () => {
    const next = patchSettings(base(), { units: "imperial", bodyweightKg: 81, onboarded: false });
    expect(next).toMatchObject({ units: "imperial", bodyweightKg: 81, onboarded: false });
  });

  it("merges into profile, session and game without dropping their other keys", () => {
    const next = patchSettings(base(), { profile: { name: "Bo" }, session: { restSeconds: 60 }, game: { startedOn: "2026-09-01" } });
    expect(next.profile).toEqual({ name: "Bo", featuredTitle: "Initiate" });
    expect(next.session).toEqual({ restSeconds: 60, sound: true, haptics: true, cues: true });
    expect(next.game).toMatchObject({ title: "Initiate", startedOn: "2026-09-01", high: { rank: "D", achievements: ["a"] } });
  });

  it("merges game.high key by key, so a partial write never lowers a high-water mark", () => {
    const next = patchSettings(base(), { game: { high: { rank: "C" } } });
    expect(next.game.high).toEqual({ rank: "C", achievements: ["a"] });
  });

  it("adds a nested object that was absent", () => {
    const current = base();
    delete current.game.high;
    const next = patchSettings(current, { game: { high: { rank: "C" } } });
    expect(next.game.high).toEqual({ rank: "C" });
  });

  it("replaces arrays whole", () => {
    const next = patchSettings(base(), { game: { pauses: [{ from: "2026-10-01", to: "2026-10-02", reason: "travel" }] } });
    expect(next.game.pauses).toEqual([{ from: "2026-10-01", to: "2026-10-02", reason: "travel" }]);
    expect(patchSettings(base(), { game: { pauses: [] } }).game.pauses).toEqual([]);
  });

  it("removes a field set to undefined", () => {
    const next = patchSettings(base(), { bodyweightKg: undefined, profile: { featuredTitle: undefined }, game: { title: undefined } });
    expect("bodyweightKg" in next).toBe(false);
    expect(next.profile).toEqual({ name: "Ana" });
    expect("title" in next.game).toBe(false);
  });

  it("keeps nested objects it does not touch by identity", () => {
    const current = base();
    const next = patchSettings(current, { units: "imperial" });
    expect(next.session).toBe(current.session);
    expect(next.game).toBe(current.game);
  });

  it("accepts null as a value (the game title can be cleared to null)", () => {
    expect(patchSettings(base(), { game: { title: null } }).game.title).toBeNull();
  });
});
