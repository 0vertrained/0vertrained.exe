// The day editor sheet: a rest switch, the title, each lift as a row (sets
// stepper, reps field, Remove) and an exercise field whose matches come
// from the catalogue as you type. A typed name the catalogue knows becomes
// that movement; any other name is kept as a custom lift. Save day hands
// back the whole day; the caller records it as tomorrow's revision.
import { useState, type KeyboardEvent } from "react";
import { Button } from "../../design/Button";
import { Sheet } from "../../design/Sheet";
import { Stepper } from "../../design/Stepper";
import { Switch } from "../../design/Switch";
import { TextInput } from "../../design/TextInput";
import type { Weekday } from "../../domain/dates";
import type { LibraryExercise } from "../../domain/program/library";
import type { PlannedLift, ProgramDay, ProgramWeek } from "../../domain/program/types";
import styles from "./DayEditorSheet.module.css";
import {
  DUPLICATE_ERROR, FULL_DAY_HINT, MAX_LIFTS, MAX_SETS, MIN_SETS, REPS_MAX_LENGTH, TITLE_MAX_LENGTH,
  dayErrors, dayFromDraft, draftFrom, duplicateOf, liftFor, liftFromLibrary, matches, type DayDraft,
} from "./dayEditorModel";

export interface DayEditorSheetProps {
  weekday: Weekday;
  day: ProgramDay;
  /** The week the day belongs to, so the whole week is validated; the day alone when omitted. */
  week?: ProgramWeek;
  onSave: (day: ProgramDay) => void;
  onClose: () => void;
}

export function DayEditorSheet({ weekday, day, week, onSave, onClose }: DayEditorSheetProps) {
  const [draft, setDraft] = useState<DayDraft>(() => draftFrom(day));
  const [query, setQuery] = useState("");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const result = dayFromDraft(draft, day);
  const errors = dayErrors(result, weekday, week);
  const full = draft.lifts.length >= MAX_LIFTS;
  const found = full ? [] : matches(query, draft.lifts);

  const patch = (p: Partial<DayDraft>) => setDraft((d) => ({ ...d, ...p }));
  const setLift = (id: string, p: Partial<PlannedLift>) => setDraft((d) => ({ ...d, lifts: d.lifts.map((l) => (l.id === id ? { ...l, ...p } : l)) }));
  const remove = (id: string) => setDraft((d) => ({ ...d, lifts: d.lifts.filter((l) => l.id !== id) }));

  const add = (lift: PlannedLift) => {
    if (duplicateOf(draft.lifts, lift.name, lift.libraryId)) {
      setAddError(DUPLICATE_ERROR);
      return;
    }
    setDraft((d) => ({ ...d, lifts: [...d.lifts, lift] }));
    setQuery("");
    setAddError(undefined);
  };
  const pick = (e: LibraryExercise) => add(liftFromLibrary(e, draft.lifts));
  const addTyped = () => {
    if (query.trim()) add(liftFor(query, draft.lifts));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addTyped();
  };

  return (
    <Sheet id={`day-${weekday}`} title={weekday} onClose={onClose} footer={<Button variant="primary" full disabled={errors.length > 0} onClick={() => onSave(result)}>Save day</Button>}>
      <div className={styles.stack}>
        <Switch label="Rest day" checked={draft.rest} onChange={(on) => patch({ rest: on })} />
        {draft.rest ? null : (
          <>
            <TextInput id="day-editor-title" label="Title" value={draft.title} placeholder="e.g. Upper body" onChange={(v) => patch({ title: v.slice(0, TITLE_MAX_LENGTH) })} />
            {draft.lifts.length > 0 ? (
              <ul className={styles.lifts} aria-label="Exercises">
                {draft.lifts.map((lift) => (
                  <li key={lift.id} className={styles.lift}>
                    <div role="group" aria-label={lift.name} className={styles.stack}>
                      <div className={styles.liftHead}>
                        <span className="ot-body-strong">{lift.name}</span>
                        <Button variant="ghost" size="sm" onClick={() => remove(lift.id)}>Remove</Button>
                      </div>
                      <Stepper id={`sets-${lift.id}`} label="Sets" value={lift.sets} min={MIN_SETS} max={MAX_SETS} onChange={(v) => setLift(lift.id, { sets: v })} />
                      <TextInput id={`reps-${lift.id}`} label="Reps" value={lift.reps} placeholder="e.g. 8-10" onChange={(v) => setLift(lift.id, { reps: v.slice(0, REPS_MAX_LENGTH) })} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={styles.add}>
              <TextInput
                id="day-editor-add"
                label="Add exercise"
                placeholder="e.g. Bench Press"
                value={query}
                disabled={full}
                error={addError}
                hint={full ? FULL_DAY_HINT : `${draft.lifts.length} of ${MAX_LIFTS}`}
                onChange={(v) => {
                  setQuery(v);
                  setAddError(undefined);
                }}
                onKeyDown={onKey}
              />
              {found.length > 0 ? (
                <div role="listbox" aria-label="Matches" className={styles.matches}>
                  {found.map((e) => (
                    <button key={e.id} type="button" role="option" aria-selected="false" className={styles.match} onClick={() => pick(e)}>
                      <span className="ot-body-strong">{e.name}</span>
                      <span className="ot-caption ot-ink-2">{e.defaultSets} × {e.defaultReps}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {query.trim() && !full ? <Button variant="ghost" onClick={addTyped}>Add as typed</Button> : null}
            </div>
          </>
        )}
        {errors[0] ? <p className={`ot-caption ot-ink-2 ${styles.line}`}>{errors[0]}</p> : null}
      </div>
    </Sheet>
  );
}
