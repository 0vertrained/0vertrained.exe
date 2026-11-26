// src/widgets/useWidgetCards.js
// In iPhone app builds with the Today widget: sends the week's day cards
// (./widgetCards) to the widget whenever they change. In a browser it does
// nothing, and the card logic only loads inside the app.

import { useEffect, useRef } from "react";
import { getTodayKey } from "../constants";
import { isNativeApp, nativePlugin } from "../native";

const SEND_DELAY_MS = 800;

// `ready`: the account's own data is loaded, so the cards show real days.
export function useWidgetCards({ ready, data, program }) {
  const native = isNativeApp() && Boolean(nativePlugin("OTWidget"));
  const lastSent = useRef("");
  const todayKey = getTodayKey();
  const today = data?.[todayKey];

  useEffect(() => {
    if (!native || !ready) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { weekCards } = await import("./widgetCards");
        if (cancelled) return;
        const cards = JSON.stringify(weekCards({ program, data: { [todayKey]: today }, todayKey }));
        if (cards === lastSent.current) return;
        lastSent.current = cards;
        await nativePlugin("OTWidget")?.update({ cards });
      } catch {
        lastSent.current = "";
      }
    }, SEND_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [native, ready, program, today, todayKey]);
}

export default useWidgetCards;
