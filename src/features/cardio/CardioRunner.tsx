// The cardio runner, full screen: the exit header with the planned kind and
// the sync dot, the plan line, the elapsed clock, one thin bar per segment
// with the current segment named under it, Pause / Resume while the clock
// is going, and the sticky primary that reads Start, then Finish, then Save
// once the distance field is up. Presentational: the clock comes in as a
// prop and the finished log goes out through onSave; nothing here touches
// app data.
import { useState, type CSSProperties } from "react";
import { Button } from "../../design/Button";
import { IconButton } from "../../design/IconButton";
import { ProgressBar } from "../../design/ProgressBar";
import { TextInput } from "../../design/TextInput";
import { TimerDisplay } from "../../design/TimerDisplay";
import type { CardioLog } from "../../domain/day/schema";
import { buildSegments, runnerLog, segmentAt, suggestPlanFromNotes, type IntervalPlan, type Segment, type TimerEvent } from "../../domain/training/cardio";
import { distanceUnit, formatDistance, type UnitSystem } from "../../domain/units";
import { cardioLogId, parseDistanceKm } from "./cardioInput";
import styles from "./CardioRunner.module.css";
import type { CardioClock } from "./useCardioClock";

export interface CardioRunnerProps {
  kind: string;
  plannedMinutes: number | null;
  plannedKm: number | null;
  effort?: string;
  notes?: string;
  units: UnitSystem;
  clock: CardioClock;
  onSave: (log: CardioLog) => void;
  onExit: () => void;
}

/** The plan as segments: the notes' intervals when they parse, else one block of the planned minutes. */
export function plannedSegments(plannedMinutes: number | null, notes: string | undefined): { segments: Segment[]; plan: IntervalPlan | null } {
  const plan = suggestPlanFromNotes(notes);
  if (plan) return { segments: buildSegments(plan), plan };
  if (plannedMinutes && plannedMinutes > 0) return { segments: [{ kind: "work", seconds: Math.round(plannedMinutes * 60), round: 1 }], plan: null };
  return { segments: [], plan: null };
}

export function segmentName(segment: Segment, rounds: number): string {
  if (segment.kind === "warmup") return "Warm-up";
  if (segment.kind === "rest") return "Rest";
  return rounds > 1 ? `Work · round ${segment.round} of ${rounds}` : "Work";
}

/** "25 min zone 2" from the minutes, "4.8 km zone 2" when planned by distance; "" with nothing planned. */
export function planLine(args: { plannedMinutes: number | null; plannedKm: number | null; effort?: string | undefined; units: UnitSystem }): string {
  const byDistance = args.plannedKm !== null && args.plannedKm > 0;
  const byTime = args.plannedMinutes !== null && args.plannedMinutes > 0;
  const target = byDistance ? formatDistance(args.plannedKm, args.units) : byTime ? `${Math.round(args.plannedMinutes as number)} min` : "";
  if (!target) return "";
  const effort = args.effort?.trim().toLowerCase() ?? "";
  return effort ? `${target} ${effort}` : target;
}

interface SegmentBar {
  key: number;
  label: string;
  /** The segment's elapsed share, 0–1 (the bar clamps). */
  value: number;
  seconds: number;
}

/** One bar per segment, each filled by how much of it has run. */
export function segmentBars(segments: readonly Segment[], elapsed: number, rounds: number): SegmentBar[] {
  const bars: SegmentBar[] = [];
  let startAt = 0;
  for (const [index, segment] of segments.entries()) {
    const value = segment.seconds > 0 ? (elapsed - startAt) / segment.seconds : 1;
    bars.push({ key: index, label: `Segment ${index + 1} of ${segments.length}: ${segmentName(segment, rounds)}`, value, seconds: segment.seconds });
    startAt += segment.seconds;
  }
  return bars;
}

/** The log for a finished session, stamped with the clock as it is now. */
function finishedLog(args: { kind: string; events: readonly TimerEvent[]; distance: string; units: UnitSystem }): CardioLog {
  const nowMs = Date.now();
  return runnerLog({ id: cardioLogId(nowMs), kind: args.kind, events: args.events, nowMs, km: parseDistanceKm(args.distance, args.units), completedAt: new Date(nowMs).toISOString() });
}

export function CardioRunner({ kind, plannedMinutes, plannedKm, effort, notes, units, clock, onSave, onExit }: CardioRunnerProps) {
  const [distance, setDistance] = useState("");
  const { segments, plan } = plannedSegments(plannedMinutes, notes);
  const rounds = plan?.rounds ?? 1;
  const elapsed = clock.elapsedSeconds;
  const current = segmentAt(segments, elapsed);
  const line = planLine({ plannedMinutes, plannedKm, effort, units });
  const finished = clock.phase === "stopped";
  const active = clock.phase === "running" || clock.phase === "paused";
  const bars = segmentBars(segments, elapsed, rounds);
  const segmentText = current ? segmentName(current.segment, rounds) : "Plan done";

  const save = () => onSave(finishedLog({ kind, events: clock.events, distance, units }));
  const primary = finished ? { label: "Save", onClick: save } : active ? { label: "Finish", onClick: clock.stop } : { label: "Start", onClick: clock.start };

  return (
    <div className={styles.screen}>
      <header className="ot-runner-head">
        <IconButton name="exit" label="Exit" onClick={onExit} />
        <h1 className={`ot-title ${styles.title}`}>{kind}</h1>
        <span className="ot-strip-sync" role="status" aria-label="Saved">
          <span className="ot-sync-dot" data-sync="synced" />
        </span>
      </header>
      <main className={`ot-screen-body ${styles.body}`}>
        {line ? <p className={`ot-body ot-ink-2 ${styles.plan}`}>{line}</p> : null}
        <TimerDisplay seconds={elapsed} size="xl" label="Elapsed" />
        {bars.length > 0 ? (
          <div className={styles.segments}>
            <div className={styles.bars} role="group" aria-label="Segments">
              {bars.map((bar) => (
                <div key={bar.key} className={styles.segment} style={{ "--ot-seg": bar.seconds } as CSSProperties}>
                  <ProgressBar kind="objective" size="thin" value={bar.value} label={bar.label} />
                </div>
              ))}
            </div>
            <p className={`ot-small-strong ${styles.segmentName}`} aria-live="polite">{segmentText}</p>
          </div>
        ) : null}
        {active ? (
          <div className={styles.controls}>
            <Button variant="secondary" size="lg" onClick={clock.running ? clock.pause : clock.resume}>{clock.running ? "Pause" : "Resume"}</Button>
          </div>
        ) : null}
        {finished ? (
          <div className={styles.distance}>
            <TextInput label={`Distance (${distanceUnit(units)})`} inputMode="decimal" hint="Optional" placeholder={units === "imperial" ? "e.g. 3.1" : "e.g. 5"} value={distance} onChange={setDistance} />
          </div>
        ) : null}
      </main>
      <div className={`ot-sticky-foot ${styles.foot}`}>
        <Button variant="primary" size="lg" full onClick={primary.onClick}>{primary.label}</Button>
      </div>
    </div>
  );
}
