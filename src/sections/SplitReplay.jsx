import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/ledger";
import { formatRunPace } from "../watch/healthRuns";
import { splitPace } from "../watch/runSplits";
import "./splitReplay.css";

const motionQuery = "(prefers-reduced-motion: reduce)";
const milesText = (miles) => Number(miles.toFixed(2)).toString();

function buildTrace(splits) {
  let distance = 0;
  let duration = 0;
  const segments = [];
  for (const split of splits) {
    const miles = Number(split.miles);
    const seconds = Number(split.seconds);
    if (!Number.isFinite(miles) || miles <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null;
    const from = distance;
    const startTime = duration;
    distance += miles;
    duration += seconds;
    segments.push({ from, to: distance, startTime, endTime: duration, pace: splitPace(split), hr: Number(split.hr) });
  }
  if (!segments.length) return null;
  const paces = segments.map((segment) => segment.pace);
  const fast = Math.max(0, Math.floor((Math.min(...paces) - 5) / 15) * 15);
  const slow = Math.ceil((Math.max(...paces) + 5) / 15) * 15;
  const x = (miles) => 100 * miles / distance;
  const y = (pace) => 100 * (pace - fast) / (slow - fast);
  // Each horizontal segment covers exactly the distance at that split's mean pace.
  const path = segments.map((segment, index) => {
    const level = y(segment.pace).toFixed(3);
    return (index ? "V" + level : "M0 " + level) + "H" + x(segment.to).toFixed(3);
  }).join("");
  return { segments, distance, duration, fast, slow, path, x, y };
}

export function SplitReplay({ splits }) {
  const trace = useMemo(() => buildTrace(splits), [splits]);
  return trace ? <Replay trace={trace} /> : null;
}

function Replay({ trace }) {
  const { segments, distance, duration, x, y } = trace;
  const root = useRef(null);
  const [position, setPosition] = useState(0);
  const [playback, setPlayback] = useState(null);
  const [reduced, setReduced] = useState(() => window.matchMedia?.(motionQuery)?.matches === true);
  const indexAt = segments.findIndex((segment) => position < segment.to);
  const index = indexAt < 0 ? segments.length - 1 : indexAt;
  const selected = segments[index];
  const finished = position >= distance;
  const hasHr = Number.isFinite(selected.hr) && selected.hr > 0;
  const distanceRange = `${milesText(selected.from)}–${milesText(selected.to)} mi`;
  const valueText = `${milesText(position)} mi, split ${index + 1} of ${segments.length}, ${formatRunPace(selected.pace)} per mile`
    + (hasHr ? `, ${selected.hr} beats per minute` : "");

  useEffect(() => {
    const media = window.matchMedia?.(motionQuery);
    const motionChanged = () => {
      const restricted = Boolean(media?.matches || root.current?.closest('[data-motion="reduced"], [data-motion="still"]'));
      setReduced(restricted);
      if (restricted) setPlayback(null);
    };
    const observer = new MutationObserver(motionChanged);
    for (let el = root.current; el; el = el.parentElement) {
      observer.observe(el, { attributes: true, attributeFilter: ["data-motion"] });
    }
    motionChanged();
    const pause = () => setPlayback(null);
    const onVisibility = () => { if (document.hidden) pause(); };
    media?.addEventListener?.("change", motionChanged);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", pause);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", motionChanged);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", pause);
    };
  }, []);

  useEffect(() => {
    if (!playback || reduced) return undefined;
    // Compress moving time for playback; interpolate distance only. The pace
    // and HR readouts always stay on the recorded split averages.
    const replayMs = Math.max(5000, Math.min(24000, segments.length * 1600));
    let frame;
    const tick = (now) => {
      const elapsed = playback.offset + Math.max(0, now - playback.started) / replayMs * duration;
      if (elapsed >= duration) {
        setPosition(distance);
        setPlayback(null);
        return;
      }
      const segment = segments.find((item) => elapsed < item.endTime);
      setPosition(segment.from + (elapsed - segment.startTime) / segment.pace);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playback, reduced, segments, distance, duration]);

  function seek(value) {
    setPlayback(null);
    setPosition(Math.max(0, Math.min(distance, value)));
  }

  function play() {
    if (playback) { setPlayback(null); return; }
    if (reduced) { seek(finished ? 0 : selected.to); return; }
    if (document.hidden) return;
    if (finished) setPosition(0);
    const offset = finished ? 0 : selected.startTime + (position - selected.from) * selected.pace;
    setPlayback({ offset, started: performance.now() });
  }

  function navigate(event) {
    let target;
    switch (event.key) {
      case "ArrowRight": case "ArrowUp": target = selected.to; break;
      case "ArrowLeft": case "ArrowDown":
        target = position > selected.from ? selected.from : segments[Math.max(0, index - 1)].from;
        break;
      case "Home": target = 0; break;
      case "End": target = distance; break;
      default: return;
    }
    event.preventDefault();
    seek(target);
  }

  const action = reduced
    ? (finished ? "Start over" : index === segments.length - 1 ? "Finish" : "Next split")
    : (playback ? "Pause" : finished ? "Replay" : "Play");
  const markerX = x(position);
  const markerY = y(selected.pace);

  return (
    <section ref={root} className="split-replay" aria-label="Split replay">
      <header className="split-replay-head">
        <div>
          <h4 className="t-title">Split replay</h4>
          <p className="t-s c2">Average pace by distance</p>
        </div>
        <button type="button" className="btn btn-s btn-sm" onClick={play}>
          <Icon name={playback ? "pause" : reduced ? "next" : "play"} size="xs" />{action}
        </button>
      </header>
      <div className="split-replay-figure">
        <div className="split-replay-scale" aria-hidden="true">
          <span>{formatRunPace(trace.fast)}</span><span>{formatRunPace(trace.slow)}</span>
        </div>
        <div className="split-replay-plot">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <rect x={x(selected.from)} width={x(selected.to - selected.from)} height="100" fill="var(--sunk)" />
            <path d="M0 0H100M0 50H100M0 100H100" className="split-replay-grid" />
            <path d={trace.path} className="split-replay-trace" />
            <path d={`M${x(selected.from)} ${markerY}H${x(selected.to)}`} className="split-replay-selected" />
          </svg>
          <span aria-hidden="true" className="split-replay-cursor" style={{ left: markerX + "%" }} />
          <span aria-hidden="true" className="split-replay-dot" style={{ left: markerX + "%", top: markerY + "%" }} />
          <input type="range" aria-label="Replay distance in miles" aria-valuetext={valueText}
            min="0" max={distance} step="any" value={position}
            onChange={(event) => seek(Number(event.target.value))} onKeyDown={navigate} />
        </div>
        <div className="split-replay-axis" aria-hidden="true"><span>0 mi</span><span className="t-c">Drag to inspect</span><span>{milesText(distance)} mi</span></div>
      </div>
      <div className="split-replay-data">
        <div><span className="t-c c2">Split {index + 1} of {segments.length}</span><span className="n-s">{distanceRange}</span></div>
        <div><span className="t-c c2">Avg pace</span><span className="n-s">{formatRunPace(selected.pace)}/mi</span></div>
        {segments.some((item) => Number.isFinite(item.hr) && item.hr > 0) && (
          <div><span className="t-c c2">Avg heart rate</span><span className="n-s">{hasHr ? selected.hr + " bpm" : "—"}</span></div>
        )}
      </div>
    </section>
  );
}
