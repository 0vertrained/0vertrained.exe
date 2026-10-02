import { useEffect, useRef } from "react";

export function triggerHaptic(pattern, enabled = true) {
  if (!enabled) return false;
  try { return navigator.vibrate?.(pattern) === true; } catch { return false; }
}

export function playRestChirp(enabled = false) {
  if (!enabled || typeof window === "undefined") return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
    oscillator.addEventListener("ended", () => context.close().catch(() => {}), { once: true });
  } catch {
    // Optional cue: visual and haptic cues still work where audio is blocked.
  }
}

export function useScreenWakeLock(active) {
  const lockRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const release = async () => {
      const lock = lockRef.current;
      lockRef.current = null;
      try { await lock?.release?.(); } catch {}
    };
    const acquire = async () => {
      if (!active || cancelled || document.visibilityState !== "visible" || !navigator.wakeLock?.request) return;
      await release();
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled || !active) {
          await lock.release().catch(() => {});
          return;
        }
        lockRef.current = lock;
        lock.addEventListener?.("release", () => {
          if (lockRef.current === lock) lockRef.current = null;
        });
      } catch {
        // Unsupported/denied wake locks are intentionally silent.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
      else void release();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void release();
    };
  }, [active]);
}
