// src/ui/useMediaQuery.js
// The shell and workout subscribe to changes in the available window width.
import { useEffect, useState } from "react";

export const DESKTOP_QUERY = "(min-width: 1024px)";

// The broadsheet tier. At >=1440px the shell widens into the ruled
// three-column layout (decision · session ledger · telemetry). The
// 1024–1439 band keeps the masthead and its 760px reading column.
export const BROADSHEET_QUERY = "(min-width: 1440px)";
// A full exercise queue fits beside the set editor in a medium-width window.
// Keep the existing laptop reading layout and the larger three-column desk.
export const WORKOUT_PANES_QUERY = "(min-width: 640px) and (max-width: 1023px)";

export function useMediaQuery(query) {
  const get = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    // Safari < 14 lacks addEventListener on MediaQueryList; fall back politely.
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, [query]);
  return matches;
}

export function useIsDesktop() {
  return useMediaQuery(DESKTOP_QUERY);
}

export function useIsBroadsheet() {
  return useMediaQuery(BROADSHEET_QUERY);
}
