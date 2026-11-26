// src/health/useHealthDaily.js
// In the iPhone app, once Apple Health is turned on in Settings ›
// Integrations: fills the last three days' steps and weight, and, without
// Oura or Whoop, sleep, resting heart rate and HRV, from Apple Health. Read
// when the app opens and each time it comes back. In a browser, or while
// it's off, it does nothing.

import { useEffect, useRef, useState } from "react";
import { isNativeApp, nativePlugin } from "../native";
import { HEALTH_DAILY_EVENT, readHealthDailyOn } from "./healthDailyState";

// How many days back are read: today, and the two before to finish them.
export const HEALTH_DAILY_DAYS = 3;

// `ready`: the account's own data is loaded, so writes land on real days.
export function useHealthDaily({ ready, data, wearables, updateEntryAtDate }) {
  const native = isNativeApp() && Boolean(nativePlugin("OTHealth"));
  const [on, setOn] = useState(() => readHealthDailyOn());
  const latest = useRef({ data, wearables, updateEntryAtDate });
  useEffect(() => { latest.current = { data, wearables, updateEntryAtDate }; });

  useEffect(() => {
    const sync = () => setOn(readHealthDailyOn());
    window.addEventListener(HEALTH_DAILY_EVENT, sync);
    return () => window.removeEventListener(HEALTH_DAILY_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!native || !ready || !on) return undefined;
    let cancelled = false;
    let running = false;
    const fill = async () => {
      if (running) return;
      running = true;
      try {
        const { days = [] } = (await nativePlugin("OTHealth")?.daily({ days: HEALTH_DAILY_DAYS })) || {};
        if (cancelled || !days.length) return;
        const { planHealthDailyFills } = await import("./healthDaily");
        if (cancelled) return;
        const { data: state, wearables: connected, updateEntryAtDate: write } = latest.current;
        for (const { dateKey, path, value } of planHealthDailyFills({ days, data: state, wearables: connected })) {
          write(dateKey, path, value);
        }
      } catch {
        // Read again next time the app comes to the front.
      } finally {
        running = false;
      }
    };
    void fill();
    const onVisible = () => { if (document.visibilityState === "visible") void fill(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [native, ready, on]);
}

export default useHealthDaily;
