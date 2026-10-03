// Device feedback for the runners: a short buzz on a banked set, a chirp and
// a double buzz when the rest timer ends, and a wake lock while a session is
// on screen. Every call is a no-op where the API is missing or the athlete
// turned it off in Profile.
import { useEffect } from "react";

export type HapticKind = "set" | "tick" | "timer" | "level" | "promotion";

const PATTERNS: Record<HapticKind, number | number[]> = { set: 20, tick: 15, timer: [40, 60, 40], level: 80, promotion: [60, 40, 120] };

export function triggerHaptic(kind: HapticKind, enabled = true): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    // some browsers throw on vibrate without a user gesture
  }
}

let audio: AudioContext | null = null;

/** One short chirp (two rising tones, 180 ms) from the Web Audio API. */
export function playChirp(enabled = true): void {
  if (!enabled || typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();
    const t0 = audio.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.08);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + i * 0.09);
      osc.stop(t0 + i * 0.09 + 0.09);
    }
  } catch {
    // audio is a nicety
  }
}

/** Keeps the screen on while `active`; released on blur, re-acquired on return. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      try {
        if (!disposed && document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
      } catch {
        // denied or unsupported: the session still works
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}
