// The rest timer: drift-free (it counts down to an end timestamp, never by
// ticks), survives a reload through sessionStorage, chirps and buzzes once
// at zero, then stays at 00:00 until the next set or Skip.
import { useCallback, useEffect, useRef, useState } from "react";
import { playChirp, triggerHaptic } from "../../app/device";

export interface RestTimerState {
  /** Seconds the timer was set for. */
  total: number;
  remaining: number;
  active: boolean;
}

export interface RestTimer extends RestTimerState {
  start: (seconds: number) => void;
  adjust: (deltaSeconds: number) => void;
  skip: () => void;
}

interface Stored {
  endsAt: number;
  total: number;
}

const KEY = "ovt-v20-rest";
const STEP = 30;
const MIN_TOTAL = 15;

function read(): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return typeof parsed.endsAt === "number" && typeof parsed.total === "number" ? { endsAt: parsed.endsAt, total: parsed.total } : null;
  } catch {
    return null;
  }
}

function write(value: Stored | null): void {
  try {
    if (value) window.sessionStorage.setItem(KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // storage is a nicety
  }
}

export function useRestTimer(options: { sound: boolean; haptics: boolean }): RestTimer {
  const [stored, setStored] = useState<Stored | null>(read);
  const [now, setNow] = useState(() => Date.now());
  const announced = useRef(false);

  useEffect(() => {
    if (!stored) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [stored]);

  const remaining = stored ? Math.max(0, Math.ceil((stored.endsAt - now) / 1000)) : 0;

  useEffect(() => {
    if (!stored) {
      announced.current = false;
      return;
    }
    if (remaining === 0 && !announced.current) {
      announced.current = true;
      playChirp(options.sound);
      triggerHaptic("timer", options.haptics);
    }
  }, [remaining, stored, options.sound, options.haptics]);

  const start = useCallback((seconds: number) => {
    const total = Math.max(MIN_TOTAL, Math.round(seconds));
    const next = { endsAt: Date.now() + total * 1000, total };
    announced.current = false;
    write(next);
    setStored(next);
    setNow(Date.now());
  }, []);

  const adjust = useCallback((delta: number) => {
    setStored((s) => {
      if (!s) return s;
      const left = Math.max(0, s.endsAt - Date.now());
      const nextLeft = Math.max(0, left + delta * 1000);
      const next = { endsAt: Date.now() + nextLeft, total: Math.max(MIN_TOTAL, s.total + delta) };
      announced.current = nextLeft === 0;
      write(next);
      return next;
    });
    setNow(Date.now());
  }, []);

  const skip = useCallback(() => {
    write(null);
    setStored(null);
  }, []);

  return { total: stored?.total ?? 0, remaining, active: stored !== null, start, adjust: (d = STEP) => adjust(d), skip };
}
