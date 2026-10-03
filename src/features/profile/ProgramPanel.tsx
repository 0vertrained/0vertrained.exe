// Panel "Program": the week as seven rows (tap → day editor), Generate and
// Switch preset, and the one rule in a caption. Every change is recorded as
// a revision effective tomorrow, so today's quest is never re-judged; the
// rows show that upcoming week, which is also what the editor builds on.
import { Button } from "../../design/Button";
import { Panel } from "../../design/Panel";
import { useAppData } from "../../data/useAppData";
import { useHashRoute } from "../../app/useHashRoute";
import { addDays, WEEKDAYS, type DateKey, type Weekday } from "../../domain/dates";
import type { BuilderInput, ProgramWeek } from "../../domain/program/types";
import { DayEditorSheet } from "./DayEditorSheet";
import { GeneratorSheet } from "./GeneratorSheet";
import { PresetSheet } from "./PresetSheet";
import styles from "./ProfileScreen.module.css";
import { dayRowMeta, upcomingRevision } from "./profileView";

export interface ProgramPanelProps {
  todayKey: DateKey;
}

const SHEET_PREFIX = "day-";

function editingWeekday(sheet: string | null): Weekday | null {
  if (!sheet?.startsWith(SHEET_PREFIX)) return null;
  const name = sheet.slice(SHEET_PREFIX.length);
  return (WEEKDAYS as readonly string[]).includes(name) ? (name as Weekday) : null;
}

export function ProgramPanel({ todayKey }: ProgramPanelProps) {
  const { state, saveProgramRevision } = useAppData();
  const { sheet, openSheet, closeSheet } = useHashRoute();
  const revision = upcomingRevision(state.program, todayKey);
  const week = revision?.week ?? null;
  const weekday = editingWeekday(sheet);
  const presetId = revision?.source.startsWith("preset:") ? revision.source.slice("preset:".length) : undefined;

  const save = (next: ProgramWeek, options: { source: string; builderInput?: BuilderInput }) => {
    saveProgramRevision(next, { effectiveFrom: addDays(todayKey, 1), ...options });
    closeSheet();
  };

  return (
    <Panel title="Program">
      {week ? (
        <ol className={styles.rows} aria-label="Week">
          {WEEKDAYS.map((d) => (
            <li key={d}>
              <button type="button" className={styles.row} onClick={() => openSheet(`${SHEET_PREFIX}${d}`)}>
                <span className="ot-tag ot-ink-2">{d.slice(0, 3)}</span>
                {" "}
                <span className={week[d].rest ? "ot-body-strong ot-ink-2" : "ot-body-strong"}>{week[d].rest ? "Rest" : week[d].title}</span>
                {" "}
                <span className="ot-caption ot-ink-2">{dayRowMeta(week[d])}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className={`ot-body ot-ink-2 ${styles.empty}`}>No program yet. Generate one or pick a preset.</p>
      )}
      <div className={styles.actions}>
        <Button full onClick={() => openSheet("generator")}>Generate new program</Button>
        <Button full onClick={() => openSheet("preset")}>Switch preset</Button>
      </div>
      <p className={`ot-caption ot-ink-2 ${styles.note}`}>Changes apply from tomorrow.</p>

      {weekday && week ? (
        <DayEditorSheet key={weekday} weekday={weekday} day={week[weekday]} week={week} onSave={(day) => save({ ...week, [weekday]: day }, { source: "custom" })} onClose={closeSheet} />
      ) : null}
      {sheet === "generator" ? (
        <GeneratorSheet initial={revision?.builderInput} onSave={(next, builderInput) => save(next, { source: "generator", builderInput })} onClose={closeSheet} />
      ) : null}
      {sheet === "preset" ? (
        <PresetSheet currentId={presetId} onSave={(preset) => save(preset.week, { source: `preset:${preset.id}` })} onClose={closeSheet} />
      ) : null}
    </Panel>
  );
}
