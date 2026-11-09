// src/__tests__/doubleEditionCascade.test.jsx
// @vitest-environment jsdom
// The Double Edition & The Cascade. Pins:
//   (1) the preset's shape — seven weekdays, AM/PM sessions everywhere,
//       cardio in every session, Sunday lifts nothing, numeric sets/reps;
//   (2) the naming rule — no personal name ("Sulek") anywhere in app source
//       (no affiliation, no implied endorsement);
//   (3) pairNext adjacency — every declared superset A-side has a following
//       exercise, and preset apply seeds the sticky pairing prefs;
//   (4) the cascade model — V12 type vocabulary ("drop"/"rp"), drop seeds at
//       ~75% rounded to 2.5, segments live INSIDE one set;
//   (5) downstream safety by construction — e1RM excludes typed sets (already
//       V12 law, re-pinned through the real series builder) and volume/tonnage
//       see one set;
//   (6) the mounted figure — offer only on completed weighted sets (TodayTab
//       mode), figure under typed sets (Session Mode mode), segment edits.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "../theme";
import { PROGRAM_PRESETS, DAYS } from "../constants";
import { CASCADE_KINDS, startCascade, addSegment, updateSegment, removeSegment, clearCascade, cascadeSummary, seedSegmentWeight } from "../cascade";
import { CascadeSet } from "../CascadeSet";
import { buildE1RMSeries } from "../e1rmTrend";
import { seedSupersetPrefsFromProgram, readSupersetPref } from "../liftLogPrefs";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
afterEach(() => { cleanup(); localStorage.clear(); });
const wrap = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>);

const preset = PROGRAM_PRESETS.doubleEdition;

describe("V17.4 The Double Edition — preset integrity", () => {
  it("exists with the house name and covers all seven weekdays with AM/PM sessions", () => {
    expect(preset).toBeTruthy();
    expect(preset.name).toBe("The Double Edition");
    for (const day of DAYS) {
      const d = preset.program[day];
      expect(d, day).toBeTruthy();
      expect(d.code).toBe("AM/PM");
      expect(d.sessions).toHaveLength(2);
      expect(d.sessions.map((s) => s.id)).toEqual(["am", "pm"]);
      for (const s of d.sessions) {
        expect(s.cardio, `${day} ${s.id} cardio`).toBeTruthy();
        expect(typeof s.cardio.type).toBe("string");
      }
    }
  });

  it("Sunday is the engine day — cardio only, zero lifting", () => {
    for (const s of preset.program.Sunday.sessions) expect(s.lifting).toHaveLength(0);
    expect(preset.program.Sunday.sessions[0].cardio.type).toMatch(/Run/);
  });

  it("every exercise carries numeric sets and reps (tonnage math depends on it)", () => {
    for (const day of DAYS) {
      for (const s of preset.program[day].sessions) {
        for (const ex of s.lifting) {
          expect(typeof ex.sets, `${day} ${ex.name}`).toBe("number");
          expect(typeof ex.reps, `${day} ${ex.name}`).toBe("number");
          expect(ex.name.length).toBeGreaterThan(2);
        }
      }
    }
  });

  it("no personal name appears anywhere in app source (no affiliation rule)", () => {
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(p);
      return /\.(js|jsx|json)$/.test(e.name) ? [p] : [];
    });
    for (const f of walk(resolve(root, "src"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/sulek/i);
    }
  });

  it("every pairNext A-side has an adjacent B-side, and only PM sessions carry supersets (one each)", () => {
    for (const day of DAYS) {
      for (const s of preset.program[day].sessions) {
        const pairs = s.lifting.filter((ex) => ex.pairNext === true);
        s.lifting.forEach((ex, i) => {
          if (ex.pairNext) expect(s.lifting[i + 1], `${day} ${ex.name} needs a B-side`).toBeTruthy();
        });
        if (s.id === "am") expect(pairs.length, `${day} AM has no supersets`).toBe(0);
        if (s.id === "pm" && s.lifting.length) expect(pairs.length, `${day} PM sprinkle`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("preset apply seeds the sticky pairing prefs, additively", () => {
    const n = seedSupersetPrefsFromProgram(preset.program);
    expect(n).toBe(4); // one per PM, Mon–Thu; Fri/Sat PMs run straight sets
    expect(readSupersetPref("Monday", "EZ-Bar Curl")).toBe(true);
    expect(readSupersetPref("Tuesday", "Cable Lateral Raise")).toBe(true);
    expect(readSupersetPref("Monday", "Rope Pushdown")).toBeFalsy(); // B-sides aren't A-sides
  });
});

describe("V17.4 The Cascade — model", () => {
  it("uses the V12 set-type vocabulary and seeds drop weight at ~75% rounded to 2.5", () => {
    expect(Object.keys(CASCADE_KINDS).sort()).toEqual(["drop", "rp"]);
    expect(seedSegmentWeight(90, "drop")).toBe("67.5");
    expect(seedSegmentWeight(90, "rp")).toBe("90");
    expect(seedSegmentWeight("", "drop")).toBe("");
  });

  it("segments live inside ONE set; add steps down for drops, holds for rest-pause; clear restores a plain set", () => {
    let set = { weight: "100", reps: "12", done: true };
    set = startCascade(set, "drop");
    expect(set.type).toBe("drop");
    expect(set.segments).toEqual([{ weight: "75", reps: "" }]);
    set = updateSegment(set, 0, "reps", "8");
    set = addSegment(set);
    expect(set.segments[1].weight).toBe("57.5"); // 75 → ~75% → rounded
    set = updateSegment(set, 1, "reps", "10");
    expect(cascadeSummary(set)).toBe("100×12 ▸ 75×8 ▸ 57.5×10");
    expect(removeSegment(removeSegment(set, 1), 0).type).toBeUndefined(); // last removal unwinds
    const plain = clearCascade(set);
    expect(plain.type).toBeUndefined();
    expect(plain.segments).toBeUndefined();
    expect(plain.weight).toBe("100");
  });

  it("e1RM excludes cascade sets by V12 law — re-pinned through the real series builder", () => {
    const data = {
      "2026-07-10": { workout: { exercises: { Bench: { sets: [{ done: true, weight: "185", reps: "8" }] } } } },
      "2026-07-12": { workout: { exercises: { Bench: { sets: [{ done: true, weight: "225", reps: "6", type: "drop", segments: [{ weight: "170", reps: "8" }] }] } } } },
    };
    const series = buildE1RMSeries(data, "Bench");
    expect(series).toHaveLength(1); // the drop day contributes nothing
    expect(series[0].date).toBe("2026-07-10");
  });
});

describe("V17.4 The Cascade — mounted figure", () => {
  it("offer mode (TodayTab): last completed weighted set only, full-word rows with plain hints", () => {
    const onChange = vi.fn();
    const { queryByTestId, rerender, getByTestId } = wrap(
      <CascadeSet set={{ weight: "90", reps: "10", done: false }} showOffer isLast onChange={onChange} />
    );
    expect(queryByTestId("cascade-offer")).toBeNull(); // not done yet
    // Done but NOT the last set → no offer (final-set doctrine; Session Mode's
    // cycler covers mid-exercise techniques).
    rerender(<ThemeProvider><CascadeSet set={{ weight: "90", reps: "10", done: true }} showOffer isLast={false} onChange={onChange} /></ThemeProvider>);
    expect(queryByTestId("cascade-offer")).toBeNull();
    rerender(<ThemeProvider><CascadeSet set={{ weight: "90", reps: "10", done: true }} showOffer isLast onChange={onChange} /></ThemeProvider>);
    const offer = getByTestId("cascade-offer");
    // Self-explanatory: full words + a plain hint per row — no
    // abbreviations, no hover-only tooltips (phones have no hover).
    expect(offer.textContent).toContain("+ drop set");
    expect(offer.textContent).toContain("+ rest-pause");
    expect(offer.textContent).toMatch(/past failure/i);
    expect(offer.textContent).toMatch(/fifteen breaths/i);
    fireEvent.click(offer.querySelectorAll("button")[0]); // + drop set
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "drop", segments: [{ weight: "67.5", reps: "" }] }));
  });

  it("the last-set gate is wired at the TodayTab call site", () => {
    const today = readFileSync(resolve(root, "src/TodayTab.jsx"), "utf8");
    expect(today).toContain("isLast={index === sets.length - 1}");
  });

  it("Session Mode (no offer): nothing renders on a straight set; the figure renders once the cycler sets DROP", () => {
    const { container, rerender, getByTestId } = wrap(
      <CascadeSet set={{ weight: "90", reps: "10", done: true }} compact onChange={() => {}} />
    );
    expect(container.textContent).toBe(""); // no offer without showOffer
    rerender(<ThemeProvider><CascadeSet set={{ weight: "90", reps: "10", done: true, type: "drop", segments: [{ weight: "67.5", reps: "" }] }} compact onChange={() => {}} /></ThemeProvider>);
    const fig = getByTestId("cascade-figure");
    expect(fig.textContent).toContain("DROP");
    expect(fig.querySelectorAll("input")).toHaveLength(2); // one segment row
  });

  it("segment edits flow through onChange with the whole set", () => {
    const onChange = vi.fn();
    const set = { weight: "90", reps: "10", done: true, type: "rp", segments: [{ weight: "90", reps: "" }] };
    const { getByLabelText } = wrap(<CascadeSet set={set} onChange={onChange} />);
    fireEvent.change(getByLabelText("Segment 1 reps"), { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ segments: [{ weight: "90", reps: "4" }] }));
  });

  it("both surfaces are wired and the cycler strips stale segments (source guards)", () => {
    const today = readFileSync(resolve(root, "src/TodayTab.jsx"), "utf8");
    expect(today).toContain("<CascadeSet set={set} showOffer");
    const composer = readFileSync(resolve(root, "src/workout/CurrentSetComposer.jsx"), "utf8");
    expect(composer).toContain('<CascadeSet set={set} compact');
    expect(composer).toContain('nextType !== "drop" && nextType !== "rp"');
  });
});
