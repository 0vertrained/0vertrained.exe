// src/watch/useWatchRuns.js
// In the iPhone app, once runs are turned on in Settings › Integrations:
// keeps this week's planned runs in the Workout app on the watch, and fills
// in the log from runs recorded on the watch, with Undo, then each run's
// mile splits and effort. In a browser, or while it's off, it does nothing,
// and its logic (./runWorkouts, ./healthRuns) is only loaded inside the app.

import { useEffect, useRef, useState } from "react";
import { getTodayKey } from "../constants";
import { isNativeApp, nativePlugin } from "../native";
import { WATCH_RUNS_EVENT, readDetailedRuns, readHandledRuns, readWatchRunsOn, writeDetailedRuns, writeHandledRuns } from "./watchRunsState";

const SCHEDULE_DELAY_MS = 1500;
// How far back recorded runs are looked for.
export const IMPORT_DAYS = 7;

// `ready`: the account's own data is loaded, so writes land on real days.
export function useWatchRuns({ ready, data, program, updateEntryAtDate, showToast }) {
  const native = isNativeApp() && Boolean(nativePlugin("OTRuns"));
  const [on, setOn] = useState(() => readWatchRunsOn());
  // Bumped when the app comes back to the front, so a new day is noticed.
  const [wake, setWake] = useState(0);
  const latest = useRef({ data, updateEntryAtDate, showToast });
  useEffect(() => { latest.current = { data, updateEntryAtDate, showToast }; });
  const lastScheduled = useRef("");
  const todayKey = getTodayKey();

  useEffect(() => {
    const sync = () => setOn(readWatchRunsOn());
    window.addEventListener(WATCH_RUNS_EVENT, sync);
    return () => window.removeEventListener(WATCH_RUNS_EVENT, sync);
  }, []);

  // Turning it off clears what was scheduled; turning it on again resends.
  useEffect(() => { if (!on) lastScheduled.current = ""; }, [on]);

  // The week's runs, sent whenever the plan for them changes. A changed run
  // gets a new id, so the phone replaces it on the watch.
  useEffect(() => {
    if (!native || !ready || !on) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { runSchedule } = await import("./runWorkouts");
        if (cancelled) return;
        const runs = runSchedule(program, todayKey);
        const signature = JSON.stringify(runs.map(({ id, date }) => [id, date]));
        if (signature === lastScheduled.current) return;
        const result = await nativePlugin("OTRuns")?.schedule({ runs: JSON.stringify(runs) });
        lastScheduled.current = result?.authorized === false ? "" : signature;
      } catch {
        lastScheduled.current = "";
      }
    }, SCHEDULE_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [native, ready, on, program, todayKey, wake]);

  // Recorded runs, read when the app opens and each time it comes back.
  useEffect(() => {
    if (!native || !ready || !on) return undefined;
    let cancelled = false;
    let running = false;

    const undo = (fills, fillWrites) => {
      const { data: state, updateEntryAtDate: write } = latest.current;
      for (const fill of fills) {
        const cardio = state?.[fill.dateKey]?.workout?.cardio || {};
        for (const { path, value } of fillWrites(fill)) {
          // Left alone if it was changed since.
          if (String(cardio[path.split(".").pop()] ?? "") === value) write(fill.dateKey, path, "");
        }
        // The splits and effort read with the run go with it.
        if (cardio.splits) write(fill.dateKey, "workout.cardio.splits", null);
        if (cardio.effortScore) {
          write(fill.dateKey, "workout.cardio.effortScore", "");
          write(fill.dateKey, "workout.cardio.effortEstimated", null);
        }
      }
    };

    // Splits and effort for logged runs that are these Health runs: read
    // once per run, in builds that can (RunsPlugin.runDetail).
    const readDetails = async (runs, filled, healthRuns) => {
      const plugin = nativePlugin("OTRuns");
      if (typeof plugin?.runDetail !== "function") return;
      const { data: state, updateEntryAtDate: write } = latest.current;
      const detailed = readDetailedRuns();
      for (const { dateKey, id } of healthRuns.planRunDetails({ runs, data: state, detailed, filled })) {
        let detail;
        try { detail = await plugin.runDetail({ id }); } catch { break; }
        if (cancelled) break;
        detailed.push(id);
        for (const { path, value } of healthRuns.detailWrites(detail)) write(dateKey, path, value);
      }
      writeDetailedRuns(detailed);
    };

    const importRuns = async () => {
      if (running) return;
      running = true;
      try {
        const { runs = [] } = (await nativePlugin("OTRuns")?.recentRuns({ days: IMPORT_DAYS })) || {};
        if (cancelled || !runs.length) return;
        const healthRuns = await import("./healthRuns");
        const { fillMessage, fillWrites, planHealthFills } = healthRuns;
        if (cancelled) return;
        const { data: state, updateEntryAtDate: write, showToast: toast } = latest.current;
        const { fills, handled } = planHealthFills({ runs, data: state, handled: readHandledRuns() });
        writeHandledRuns(handled);
        for (const fill of fills) {
          for (const { path, value } of fillWrites(fill)) write(fill.dateKey, path, value);
        }
        if (fills.length) toast?.(fillMessage(fills, getTodayKey()), { action: "Undo", onAction: () => undo(fills, fillWrites) });
        await readDetails(runs, fills.map((fill) => fill.dateKey), healthRuns);
      } catch {
        // Read again next time the app comes to the front.
      } finally {
        running = false;
      }
    };

    void importRuns();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setWake((count) => count + 1);
      void importRuns();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [native, ready, on]);
}

export default useWatchRuns;
