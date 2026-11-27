// src/watch/useWatchRuns.js
// In the iPhone app, once runs are turned on in Settings › Integrations:
// keeps this week's planned runs in the Workout app on the watch, and fills
// in the log from runs recorded on the watch, with Undo, then each run's
// mile splits and effort. In a browser, or while it's off, it does nothing,
// and its logic (./runWorkouts, ./healthRuns) is only loaded inside the app.

import { APP_FOREGROUND_EVENT } from "../integrations/appForeground";
import { useDeviceToggle } from "../health/useDeviceToggle";
import { useEffect, useRef, useState } from "react";
import { getTodayKey } from "../constants";
import { isNativeApp, nativePlugin } from "../native";
import { WATCH_RUNS_EVENT, clearWatchSchedule, scheduleWatchRuns, readDetailedRuns, readHandledRuns, readWatchRunsOn, writeDetailedRuns, writeHandledRuns } from "./watchRunsState";

const SCHEDULE_DELAY_MS = 1500;
// How far back recorded runs are looked for.
export const IMPORT_DAYS = 7;

// `ready`: the account's own data is loaded, so writes land on real days.
export function useWatchRuns({ owner, ready, data, program, updateEntryAtDate, showToast }) {
  const native = isNativeApp() && Boolean(nativePlugin("OTRuns"));
  const on = useDeviceToggle(WATCH_RUNS_EVENT, readWatchRunsOn, owner, native && ready);
  // Bumped when the app comes back to the front, so a new day is noticed.
  const [wake, setWake] = useState(0);
  const latest = useRef({ owner, data, program, updateEntryAtDate, showToast });
  useEffect(() => { latest.current = { owner, data, program, updateEntryAtDate, showToast }; });
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

    const undone = new Set();
    const undo = (fills, fillWrites) => {
      const { data: state, updateEntryAtDate: write } = latest.current;
      for (const fill of fills) {
        const base = fill.path || "workout.cardio";
        if (latest.current.owner !== owner) return;
        const cardio = base.split(".").reduce((entry, key) => entry?.[key], state?.[fill.dateKey]) || {};
        const ref = fill.activityRefs[0];
        if (!cardio.activityRefs?.some(item => item.source === "apple" && item.id === ref.id)) continue;
        undone.add(ref.id);
        for (const { path, value } of fillWrites(fill)) {
          // Left alone if it was changed since.
          const current = cardio[path.split(".").pop()];
          if (Array.isArray(value)) {
            if (JSON.stringify(current) === JSON.stringify(value)) write(fill.dateKey, path, null);
          } else if (String(current ?? "") === String(value)) write(fill.dateKey, path, "");
        }
        // The splits and effort read with the run go with it.
        if (cardio.splits) write(fill.dateKey, `${base}.splits`, null);
        if (cardio.segments) write(fill.dateKey, `${base}.segments`, null);
        if (cardio.effortScore) {
          write(fill.dateKey, `${base}.effortScore`, "");
          write(fill.dateKey, `${base}.effortEstimated`, null);
        }
      }
    };

    // Splits and effort for logged runs that are these Health runs: read
    // once per run, in builds that can (RunsPlugin.runDetail).
    const readDetails = async (runs, filled, healthRuns) => {
      const plugin = nativePlugin("OTRuns");
      if (typeof plugin?.runDetail !== "function") return;
      const { data: state, updateEntryAtDate: write } = latest.current;
      const detailed = readDetailedRuns(owner);
      for (const { dateKey, id, path: base, modality } of healthRuns.planRunDetails({ runs, data: state, detailed, filled })) {
        let detail;
        try { detail = await plugin.runDetail({ id }); } catch { break; }
        if (cancelled) return;
        if (undone.has(id)) continue;
        const details = healthRuns.detailWrites(detail, base, modality);
        if (details.length) detailed.push(id);
        for (const { path, value } of details) write(dateKey, path, value);
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
        const { data: state, updateEntryAtDate: write, showToast: toast } = latest.current;
        const { fills, handled } = planHealthFills({ runs, program: latest.current.program, data: state, handled: readHandledRuns(owner) });
        writeHandledRuns(handled, owner);
        for (const fill of fills) {
          for (const { path, value } of fillWrites(fill)) write(fill.dateKey, path, value);
        }
        if (fills.length) toast?.(fillMessage(fills, getTodayKey()), { action: "Undo", onAction: () => undo(fills, fillWrites) });
        await readDetails(runs, fills, healthRuns);
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
