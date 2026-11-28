// src/watch/useWatchRuns.js
// In the iPhone app, once runs are turned on in Settings › Integrations:
// keeps this week's planned runs in the Workout app on the watch, and fills
// in the log from runs recorded on the watch, with Undo, then each run's
// mile splits and effort. In a browser, or while it's off, it does nothing,
// and its logic (./runWorkouts, ./healthRuns) is only loaded inside the app.

import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";
import { useDeviceToggle } from "../health/useDeviceToggle";
import { useEffect, useRef, useState } from "react";
import { defaultDay, getTodayKey } from "../constants";
import { setEntryPath } from "../entryPath";
import { isNativeApp, nativePlugin } from "../native";
import { WATCH_RUNS_EVENT, clearWatchSchedule, scheduleWatchRuns, readDetailedRuns, readHandledRuns, readWatchRunsOn, writeDetailedRuns, writeHandledRuns } from "./watchRunsState";

const SCHEDULE_DELAY_MS = 1500;
// How far back recorded runs are looked for.
export const IMPORT_DAYS = 7;

// `ready`: the account's own data is loaded, so writes land on real days.
export function useWatchRuns({ owner, ready, data, program, updateEntryAtDate, showToast, stageDays }) {
  const native = isNativeApp() && Boolean(nativePlugin("OTRuns"));
  const on = useDeviceToggle(WATCH_RUNS_EVENT, readWatchRunsOn, owner, native && ready);
  // Bumped when the app comes back to the front, so a new day is noticed.
  const [wake, setWake] = useState(0);
  const latest = useRef({ owner, data, program, updateEntryAtDate, showToast, stageDays });
  useEffect(() => { latest.current = { owner, data, program, updateEntryAtDate, showToast, stageDays }; });
  const lastScheduled = useRef("");
  const todayKey = getTodayKey();

  // Turning it off clears what was scheduled; turning it on again resends.
  useEffect(() => { lastScheduled.current = ""; }, [on, owner]);

  // A second account can opt out while the first account still has runs on
  // this Watch. Remove our scheduled workouts once, including on cold launch.
  useEffect(() => {
    if (!native || !ready || !owner || on) return undefined;
    let cancelled = false;
    const clear = () => { void clearWatchSchedule(nativePlugin("OTRuns"), { current: () => !cancelled }).catch(() => {}); };
    clear();
    window.addEventListener(APP_FOREGROUND_EVENT, clear);
    return () => {
      cancelled = true;
      window.removeEventListener(APP_FOREGROUND_EVENT, clear);
    };
  }, [native, ready, owner, on]);

  // The week's runs, sent whenever the plan for them changes. A changed run
  // gets a new id, so the phone replaces it on the watch.
  useEffect(() => {
    if (!native || !ready || !on) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { runSchedule } = await import("./runWorkouts");
        if (cancelled) return;
        const scheduled = runSchedule(program, todayKey);
        const plugin = nativePlugin("OTRuns");
        const status = await plugin?.status?.();
        if (cancelled) return;
        // Installed iPhone builds before multisport interpret all specs as runs.
        const runs = status?.cardioVersion >= 2 ? scheduled : scheduled.filter(plan => plan.activity === "run");
        const signature = JSON.stringify(runs.map(({ id, date }) => [id, date]));
        if (signature === lastScheduled.current) return;
        const result = await scheduleWatchRuns(plugin, runs, () => !cancelled);
        if (!cancelled) lastScheduled.current = result?.authorized === false ? "" : signature;
      } catch {
        if (!cancelled) lastScheduled.current = "";
      }
    }, SCHEDULE_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [native, ready, on, owner, program, todayKey, wake]);

  // Recorded runs, read when the app opens and each time it comes back.
  useEffect(() => {
    if (!native || !ready || !on) return undefined;
    let cancelled = false;
    let running = false;

    const journal = new Map();
    const currentDay = date => {
      const rendered = latest.current.data?.[date];
      const staged = journal.get(date);
      return staged && staged.base === rendered ? staged.day : rendered;
    };
    const read = (date, path) => path.split(".").reduce((v, key) => v?.[key], currentDay(date));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    // Keep the active day's pending writes available to a detail response or
    // Undo even when React has not yet rendered the preceding batch.
    const save = edits => {
      if (cancelled || latest.current.owner !== owner) return false;
      if (!edits.length) return true;
      const days = {};
      for (const { dateKey, path, value } of edits) {
        const day = days[dateKey] || currentDay(dateKey) || defaultDay();
        days[dateKey] = setEntryPath(day, path.split("."), value);
      }
      if (latest.current.stageDays && !latest.current.stageDays(days)) return false;
      for (const [date, day] of Object.entries(days)) journal.set(date, { base: latest.current.data?.[date], day });
      for (const { dateKey, path, value } of edits) latest.current.updateEntryAtDate(dateKey, path, value);
      return true;
    };

    const undone = new Set();
    let latestReceipts = new Map();
    const undo = receipts => {
      const edits = [];
      const ids = [];
      for (const [id, receipt] of receipts) {
        const { dateKey, base, fields } = receipt;
        const refs = read(dateKey, base + ".activityRefs");
        if (!refs?.some(ref => ref.source === "apple" && ref.id === id)) continue;
        ids.push(id);
        for (const { path, value, previous } of fields) {
          if (path === base + ".activityRefs") {
            const remaining = refs.filter(ref => ref.source !== "apple" || ref.id !== id);
            edits.push({ dateKey, path, value: remaining.length ? remaining : previous ?? null });
          } else if (same(read(dateKey, path), value)) {
            edits.push({ dateKey, path, value: previous === undefined ? (typeof value === "string" ? "" : null) : previous });
          }
        }
      }
      if (save(edits)) ids.forEach(id => undone.add(id));
      else if (!cancelled) latest.current.showToast?.("Could not save the undo. Try again.", { action: "Retry", onAction: () => undo(receipts) });
    };

    // A temporarily unavailable Health workout is retried on foreground.
    // Keep processing the other workouts returned by the same Health query.
    const readDetails = async (runs, filled, healthRuns, receipts) => {
      const plugin = nativePlugin("OTRuns");
      if (typeof plugin?.runDetail !== "function") return;
      const detailed = readDetailedRuns(owner);
      const plans = healthRuns.planRunDetails({ runs, data: latest.current.data, detailed, filled });
      for (const { dateKey, id, path: base = "workout.cardio", modality } of plans) {
        if (cancelled) return;
        const before = read(dateKey, base);
        let detail;
        try { detail = await plugin.runDetail({ id }); } catch { continue; }
        if (cancelled) return;
        if (undone.has(id)) continue;
        const current = read(dateKey, base);
        if (!same(current?.activityRefs, before?.activityRefs) || current?.miles !== before?.miles) continue;
        const available = healthRuns.detailWrites(detail, base, modality);
        if (!available.length) continue;
        const edits = available
          .filter(({ path }) => {
            const field = path.split(".").pop();
            const previous = current?.[field];
            // A manual effort is a pair. Preserve both fields and any
            // independently recorded splits or intervals.
            if (field === "effortEstimated" && current?.effortScore) return false;
            return previous == null || previous === "" || (Array.isArray(previous) && previous.length === 0);
          })
          .map(edit => ({ ...edit, dateKey, previous: read(dateKey, edit.path) }));
        if (save(edits)) {
          detailed.push(id);
          receipts.get(id)?.fields.push(...edits);
        }
      }
      if (!cancelled) writeDetailedRuns(detailed, owner);
    };

    const importRuns = async () => {
      if (running) return;
      running = true;
      try {
        const result = await nativePlugin("OTRuns")?.recentRuns({ days: IMPORT_DAYS });
        const runs = (result?.runs || []).filter(run => !run.owner || run.owner === owner);
        if (cancelled || !runs.length) return;
        const healthRuns = await import("./healthRuns");
        const { fillMessage, fillWrites, planHealthFills } = healthRuns;
        if (cancelled) return;
        const { data: state, showToast: toast } = latest.current;
        const { fills, handled } = planHealthFills({ runs, program: latest.current.program, data: state, handled: readHandledRuns(owner) });
        const receipts = new Map();
        const edits = [];
        for (const fill of fills) {
          const { dateKey } = fill;
          const fields = fillWrites(fill).map(edit => ({ ...edit, dateKey, previous: read(dateKey, edit.path) }));
          // The newly imported Apple identity follows any earlier links on a climb.
          const id = fill.activityRefs.at(-1).id;
          receipts.set(id, { dateKey, base: fill.path || "workout.cardio", fields });
          edits.push(...fields);
        }
        if (!save(edits)) {
          toast?.("Apple Health workouts are waiting for space in the offline log.");
          return;
        }
        writeHandledRuns(handled, owner);
        if (fills.length) {
          latestReceipts = receipts;
          toast?.(fillMessage(fills, getTodayKey()), { action: "Undo", onAction: () => undo(receipts) });
        }
        await readDetails(runs, fills, healthRuns, latestReceipts);
      } catch {
        // Read again next time the app comes to the front.
      } finally {
        running = false;
      }
    };

    void importRuns();
    const onVisible = () => {
      lastScheduled.current = "";
      setWake((count) => count + 1);
      void importRuns();
    };
    window.addEventListener(APP_FOREGROUND_EVENT, onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener(APP_FOREGROUND_EVENT, onVisible);
    };
  }, [native, ready, on, owner]);
}

export default useWatchRuns;
