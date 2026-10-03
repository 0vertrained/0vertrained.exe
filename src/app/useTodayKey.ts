// The athlete's local calendar day, re-read at local midnight and whenever
// the tab comes back (a phone left open overnight must not keep logging
// yesterday). The app layer reads the clock; the domain never does.
import { useEffect, useState } from "react";
import type { DateKey } from "../domain/dates";

export function localDateKey(date: Date): DateKey {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Minutes east of UTC for the device, as the engine's utcOffsetMinutes. */
export function localUtcOffsetMinutes(date: Date = new Date()): number {
  return -date.getTimezoneOffset();
}

function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

export function useTodayKey(): DateKey {
  const [key, setKey] = useState<DateKey>(() => localDateKey(new Date()));
  useEffect(() => {
    let timer = 0;
    const refresh = () => {
      setKey(localDateKey(new Date()));
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, msUntilNextLocalMidnight(new Date()));
    };
    timer = window.setTimeout(refresh, msUntilNextLocalMidnight(new Date()));
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return key;
}
