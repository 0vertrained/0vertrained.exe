// src/watch/useWatchBridge.js
// In the iPhone app: keeps the watch's copy of the week's plans current and
// writes the sets logged on the watch into the log. In a browser it does
// nothing, and the plan logic (./watchPlan) is only loaded inside the app.
//
// The phone app keeps watch events in its own inbox until they're confirmed
// here (ios/App/App/WatchLink.swift), so an event that can't be written now
// is simply read again on the next drain.

import { useEffect, useRef, useState } from "react";
import { getTodayKey } from "../constants";
import { isNativeApp, nativePlugin } from "../native";

const SEND_DELAY_MS = 400;

// `ready`: the account's own data is loaded, so writes land on real days.
export function useWatchBridge({ ready, data, program, updateEntryAtDate }) {
  const native = isNativeApp() && Boolean(nativePlugin("OTWatch"));
  // What the drains read: the latest render's data and writer.
  const latest = useRef({ data, program, updateEntryAtDate });
  useEffect(() => { latest.current = { data, program, updateEntryAtDate }; });
  // Ids of the watch events dealt with, sent back in the plan so the watch
  // stops showing those sets as its own. Bumping the version resends it.
  const seen = useRef([]);
  const [seenVersion, setSeenVersion] = useState(0);
  const lastSent = useRef("");
  // Days as this hook last wrote them, until React's data catches up. An
  // entry is used only while the day it was built on is still the one in
  // state, so a second drain never works from a day missing the first one's
  // sets, and anything newer from the phone always wins.
  const written = useRef({});
  const todayKey = getTodayKey();

  useEffect(() => {
    if (!native || !ready) return undefined;
    const watch = nativePlugin("OTWatch");
    let cancelled = false;
    let running = false;
    let queued = false;

    const currentData = () => {
      const state = latest.current.data || {};
      const merged = { ...state };
      for (const [dateKey, entry] of Object.entries(written.current)) {
        if (state[dateKey] === entry.base) merged[dateKey] = entry.day;
        else delete written.current[dateKey];
      }
      return merged;
    };

    const drain = async () => {
      if (running) { queued = true; return; }
      running = true;
      try {
        do {
          queued = false;
          const { events = [] } = (await watch.pending()) || {};
          if (cancelled || events.length === 0) break;
          const { applyWatchEvents } = await import("./watchPlan");
          const state = latest.current.data || {};
          const result = applyWatchEvents({ data: currentData(), program: latest.current.program, events });
          for (const [dateKey, day] of Object.entries(result.days)) {
            written.current[dateKey] = { base: state[dateKey], day };
          }
          for (const { dateKey, path, value } of result.writes) latest.current.updateEntryAtDate(dateKey, path, value);
          if (result.processed.length) {
            seen.current = [...seen.current, ...result.processed].slice(-50);
            setSeenVersion((version) => version + 1);
          }
          await watch.ack({ ids: result.processed });
        } while (queued && !cancelled);
      } catch {
        // Left in the phone's inbox; the next drain reads it again.
      } finally {
        running = false;
      }
    };

    void drain();
    let listener = null;
    try { listener = watch.addListener?.("watchEvent", () => { void drain(); }); } catch { listener = null; }
    const onVisible = () => { if (document.visibilityState === "visible") void drain(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      Promise.resolve(listener).then((handle) => handle?.remove?.()).catch(() => {});
    };
  }, [native, ready]);

  // Send the week when anything in it changes. A week the watch already has
  // isn't sent again.
  useEffect(() => {
    if (!native || !ready) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { buildWatchWeek } = await import("./watchPlan");
        if (cancelled) return;
        const week = buildWatchWeek({ data, program, todayKey, seen: seen.current });
        const { sentAt, ...content } = week;
        void sentAt;
        const signature = JSON.stringify(content);
        if (signature === lastSent.current) return;
        lastSent.current = signature;
        await nativePlugin("OTWatch")?.sendPlan({ plan: JSON.stringify(week) });
      } catch {
        lastSent.current = "";
      }
    }, SEND_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [native, ready, data, program, todayKey, seenVersion]);
}

export default useWatchBridge;
