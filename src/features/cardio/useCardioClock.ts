// The cardio runner's clock. Its state is the list of domain TimerEvents
// (start, pause, resume, stop); the elapsed time is always recomputed from
// activeSeconds(events, Date.now()), re-read every 250 ms while running and
// when the tab comes back, never incremented, so a background tab or a late
// tick still shows the real time. The events live in sessionStorage per day
// so a reload keeps the clock. This hook is the one place the runner reads
// the wall clock; the domain never does.
import { useCallback, useEffect, useState } from "react";
import type { DateKey } from "../../domain/dates";
import { activeSeconds, type TimerEvent } from "../../domain/training/cardio";

export const CLOCK_STORAGE_PREFIX = "ovt-v20-cardio:";
/** How often the elapsed time is re-read while running. */
export const TICK_MS = 250;

export type ClockPhase = "idle" | "running" | "paused" | "stopped";

export interface CardioClockState {
  events: readonly TimerEvent[];
  running: boolean;
  /** Active seconds so far, paused time excluded; fractional. */
  elapsedSeconds: number;
  phase: ClockPhase;
}

export interface CardioClockActions {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Forget the session: empties the events and their stored copy. */
  reset(): void;
}

export type CardioClock = CardioClockState & CardioClockActions;

export const clockStorageKey = (dateKey: DateKey): string => `${CLOCK_STORAGE_PREFIX}${dateKey}`;

const EVENT_TYPES: ReadonlySet<string> = new Set(["start", "pause", "resume", "stop"]);

function isTimerEvent(value: unknown): value is TimerEvent {
  if (typeof value !== "object" || value === null) return false;
  const { type, atMs } = value as Record<string, unknown>;
  return typeof type === "string" && EVENT_TYPES.has(type) && typeof atMs === "number" && Number.isFinite(atMs);
}

function readEvents(key: string): TimerEvent[] {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTimerEvent) : [];
  } catch {
    return [];
  }
}

function writeEvents(key: string, events: readonly TimerEvent[]): void {
  try {
    if (events.length === 0) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(events));
  } catch {
    // Storage unavailable or full: the clock still runs in memory.
  }
}

/**
 * Where the events leave the clock, by the same rules activeSeconds applies:
 * a pause while paused is ignored, and nothing counts after stop.
 */
export function clockPhase(events: readonly TimerEvent[]): ClockPhase {
  let started = false;
  let running = false;
  for (const e of [...events].sort((a, b) => a.atMs - b.atMs)) {
    if ((e.type === "start" && !running) || (e.type === "resume" && started && !running)) {
      running = true;
      started = true;
    } else if ((e.type === "pause" || e.type === "stop") && running) {
      running = false;
    }
    if (e.type === "stop" && started) return "stopped";
  }
  return !started ? "idle" : running ? "running" : "paused";
}

interface Loaded {
  key: string;
  events: TimerEvent[];
}

export function useCardioClock(dateKey: DateKey): CardioClock {
  const key = clockStorageKey(dateKey);
  const [loaded, setLoaded] = useState<Loaded>(() => ({ key, events: readEvents(key) }));
  const [now, setNow] = useState(() => Date.now());

  // A new day: read that day's events (state adjusted during render, so the
  // stale day never reaches the screen).
  if (loaded.key !== key) setLoaded({ key, events: readEvents(key) });

  const events = loaded.events;
  const phase = clockPhase(events);
  const running = phase === "running";

  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running]);

  const commit = useCallback((next: TimerEvent[]) => {
    setLoaded({ key, events: next });
    writeEvents(key, next);
  }, [key]);

  const push = useCallback((type: TimerEvent["type"]) => {
    const atMs = Date.now();
    setNow(atMs);
    commit([...events, { type, atMs }]);
  }, [commit, events]);

  const start = useCallback(() => {
    if (phase === "idle") push("start");
  }, [phase, push]);
  const pause = useCallback(() => {
    if (phase === "running") push("pause");
  }, [phase, push]);
  const resume = useCallback(() => {
    if (phase === "paused") push("resume");
  }, [phase, push]);
  const stop = useCallback(() => {
    if (phase === "running" || phase === "paused") push("stop");
  }, [phase, push]);
  const reset = useCallback(() => commit([]), [commit]);

  const elapsedSeconds = activeSeconds(events, running ? now : undefined);
  return { events, running, elapsedSeconds, phase, start, pause, resume, stop, reset };
}
