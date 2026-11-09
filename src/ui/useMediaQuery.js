// src/ui/useMediaQuery.js
// Shared viewport hook for the broadsheet shell. One breakpoint, one
// definition: at >=1024px the app swaps the mobile dock for masthead
// navigation. Components subscribe here instead of each guessing widths.
import { useEffect, useState } from "react";

export const DESKTOP_QUERY = "(min-width: 1024px)";

// The broadsheet tier. At >=1440px the shell widens into the ruled
// three-column layout (decision · session ledger · telemetry). Below it,
// every layout is as before — the 1024–1439 band keeps the
// masthead + single 760px column exactly as shipped (plan decision D1).
export const BROADSHEET_QUERY = "(min-width: 1440px)";

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
