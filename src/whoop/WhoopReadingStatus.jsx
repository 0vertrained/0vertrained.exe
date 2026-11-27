import { useEffect, useState } from "react";

function ageText(timestamp, now) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return new Date(timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function WhoopReadingStatus({ batteryPercent, batteryAt, lastReadingAt }) {
  const [now, setNow] = useState(() => Date.now());
  const hasTimes = Boolean(lastReadingAt || batteryAt);
  useEffect(() => {
    if (!hasTimes) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [hasTimes]);
  const battery = Number.isFinite(batteryPercent) && batteryPercent >= 0 && batteryPercent <= 100;
  return (
    <p className="t-s c2" aria-label="Strap status">
      Battery {battery ? `${Math.round(batteryPercent)}%` : "unknown"}
      {battery && batteryAt > 0 && now - batteryAt >= 3_600_000 && ` (read ${ageText(batteryAt, now)})`}
      {" · Last reading "}{lastReadingAt > 0 ? <time dateTime={new Date(lastReadingAt).toISOString()}>{ageText(lastReadingAt, now)}</time> : "unavailable"}
    </p>
  );
}
