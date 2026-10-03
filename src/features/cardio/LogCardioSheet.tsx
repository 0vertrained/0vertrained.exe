// Manual cardio entry for a session done elsewhere (a class, a watch, a
// walk): a sheet with the minutes and an optional distance in the athlete's
// units. Save stays disabled until the minutes are a positive number. It
// builds a CardioLog with source "manual"; the caller stores it.
import { useState } from "react";
import { Button } from "../../design/Button";
import { Sheet } from "../../design/Sheet";
import { TextInput } from "../../design/TextInput";
import type { CardioLog } from "../../domain/day/schema";
import { distanceUnit, type UnitSystem } from "../../domain/units";
import { cardioLogId, parseDistanceKm, parseMinutes } from "./cardioInput";
import styles from "./LogCardioSheet.module.css";

export interface LogCardioSheetProps {
  /** The planned kind the log is filed under ("Easy Run"). */
  kind: string;
  units: UnitSystem;
  onSave: (log: CardioLog) => void;
  onClose: () => void;
}

export function LogCardioSheet({ kind, units, onSave, onClose }: LogCardioSheetProps) {
  const [minutesText, setMinutesText] = useState("");
  const [distanceText, setDistanceText] = useState("");
  const minutes = parseMinutes(minutesText);

  const save = () => {
    if (minutes === null) return;
    const nowMs = Date.now();
    onSave({ id: cardioLogId(nowMs), kind, minutes, km: parseDistanceKm(distanceText, units), source: "manual", completedAt: new Date(nowMs).toISOString() });
  };

  return (
    <Sheet id="log-cardio" title="Log cardio" onClose={onClose} footer={<Button variant="primary" full disabled={minutes === null} onClick={save}>Save</Button>}>
      <p className={`ot-small ot-ink-2 ${styles.kind}`}>{kind}</p>
      <div className={styles.fields}>
        <TextInput label="Minutes" inputMode="numeric" placeholder="e.g. 30" value={minutesText} onChange={setMinutesText} />
        <TextInput label={`Distance (${distanceUnit(units)}), optional`} inputMode="decimal" placeholder={units === "imperial" ? "e.g. 3.1" : "e.g. 5"} value={distanceText} onChange={setDistanceText} />
      </div>
    </Sheet>
  );
}
