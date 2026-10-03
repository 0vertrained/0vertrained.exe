// The morning check-in: four taps, an illness switch with the allowance left
// as its sublabel, an optional note, and a live result line. Done issues
// today's quest. A check-in can only lower a quest, never raise it, and once
// the session has started the tier stays.
import { useState } from "react";
import { Button } from "../../design/Button";
import { SegmentedControl } from "../../design/SegmentedControl";
import { Sheet } from "../../design/Sheet";
import { Switch } from "../../design/Switch";
import { TextInput } from "../../design/TextInput";
import { TierBadge } from "../../design/TierBadge";
import type { DateKey } from "../../domain/dates";
import type { CheckIn, DayMap, DayV2, QuestSnapshot } from "../../domain/day/schema";
import { issueDailyQuest, questReason } from "../../domain/game/quest";
import type { TrialSpec } from "../../domain/game/types";
import { WEEKDAYS } from "../../domain/dates";
import { plannedCardioMinutes, plannedSetsForDay, revisionAt } from "../../domain/program/revisions";
import type { ProgramDay, ProgramPayloadV2 } from "../../domain/program/types";
import { CHECKIN_ROWS } from "../../domain/readiness/checkin";
import { decideTier } from "../../domain/readiness/tier";
import styles from "./CheckinSheet.module.css";

export interface CheckinSheetProps {
  todayKey: DateKey;
  day: DayV2 | undefined;
  days: DayMap;
  program: ProgramPayloadV2;
  planned: ProgramDay;
  allowanceLeft: number;
  trial: TrialSpec | null;
  onClose: () => void;
  onDone: (checkin: CheckIn, quest: QuestSnapshot) => void;
}

const NOTE_MAX = 140;

export function CheckinSheet({ todayKey, day, days, program, planned, allowanceLeft, trial, onClose, onDone }: CheckinSheetProps) {
  const [checkin, setCheckin] = useState<CheckIn>(() => ({ ...(day?.checkin ?? {}) }));
  const decision = decideTier({ isRestDay: planned.rest, checkin });
  const sessionStarted = Object.values(day?.workout.exercises ?? {}).some((log) => log.sets.some((s) => s.done));
  const set = (patch: Partial<CheckIn>) => setCheckin((c) => ({ ...c, ...patch }));

  const done = () => {
    const week = revisionAt(program, todayKey).week;
    const plannedWeeklySets = WEEKDAYS.reduce((n, d) => n + plannedSetsForDay(week[d]), 0);
    const plannedWeeklyCardioMinutes = WEEKDAYS.reduce((n, d) => n + plannedCardioMinutes(week[d].cardio), 0);
    const quest = day?.quest && sessionStarted
      ? day.quest
      : issueDailyQuest({ dateKey: todayKey, programDay: planned, plannedWeeklySets, plannedWeeklyCardioMinutes, checkin, days, issuedAt: new Date().toISOString(), trial });
    onDone(checkin, quest);
  };

  return (
    <Sheet id="checkin" title="How do you feel today?" onClose={onClose} footer={<Button variant="primary" full onClick={done}>Done</Button>}>
      <p className={`ot-small ot-ink-2 ${styles.rule}`}>{sessionStarted ? "The session has started, so today's quest keeps its tier." : "A check-in can only lower today's quest, never raise it."}</p>
      <div className={styles.rows}>
        {CHECKIN_ROWS.map((row) => (
          <SegmentedControl
            key={row.field}
            inline
            label={row.label}
            options={row.options.map((o) => ({ value: String(o.value), label: o.text }))}
            value={checkin[row.field] === undefined ? "" : String(checkin[row.field])}
            onChange={(v) => set({ [row.field]: Number(v) })}
          />
        ))}
      </div>
      <div className={styles.illness}>
        <Switch label="Ill or injured" sublabel={`${allowanceLeft} of 14 protected days left this quarter`} checked={checkin.illness === true} onChange={(on) => set({ illness: on || undefined })} />
      </div>
      <TextInput label="Note" multiline maxLength={NOTE_MAX} placeholder="e.g. tweaked left knee" value={checkin.note ?? ""} onChange={(v) => set({ note: v || undefined })} />
      <div className={styles.result} aria-live="polite">
        <span className="ot-small-strong">Today:</span>
        <TierBadge tier={decision.tier} />
        <span className="ot-small ot-ink-2">{questReason(decision, planned)}</span>
      </div>
    </Sheet>
  );
}
