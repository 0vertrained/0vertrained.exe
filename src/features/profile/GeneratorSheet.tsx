// The program generator as a sheet: the four onboarding answers, the week
// they make as seven rows, and one primary behind a confirm. Nothing is
// saved until the dialog's Generate.
import { useState } from "react";
import { Button } from "../../design/Button";
import { Dialog } from "../../design/Dialog";
import { Panel } from "../../design/Panel";
import { SegmentedControl } from "../../design/SegmentedControl";
import { Sheet } from "../../design/Sheet";
import { WEEKDAYS } from "../../domain/dates";
import { buildProgram } from "../../domain/program/builder";
import type { BuilderGoal, BuilderInput, DaysPerWeek, EquipmentMode, ProgramWeek } from "../../domain/program/types";
import { builderInputFor, DAY_OPTIONS, EQUIPMENT_OPTIONS, EXPERIENCE_OPTIONS, GOAL_OPTIONS, ONBOARDING_DEFAULTS } from "../onboarding/plan";
import styles from "./ProgramSheets.module.css";

export interface GeneratorSheetProps {
  /** The answers to start from (the current revision's, when it was generated). */
  initial?: BuilderInput;
  onSave: (week: ProgramWeek, input: BuilderInput) => void;
  onClose: () => void;
}

function weekFor(input: BuilderInput): ProgramWeek | null {
  try {
    return buildProgram(input);
  } catch {
    return null;
  }
}

export function GeneratorSheet({ initial, onSave, onClose }: GeneratorSheetProps) {
  const [input, setInput] = useState<BuilderInput>(() => initial ?? builderInputFor(ONBOARDING_DEFAULTS));
  const [confirm, setConfirm] = useState(false);
  const week = weekFor(input);
  const set = <K extends keyof BuilderInput>(key: K, value: BuilderInput[K]) => setInput((i) => ({ ...i, [key]: value }));

  return (
    <Sheet id="generator" title="Generate new program" onClose={onClose} footer={<Button variant="primary" full disabled={!week} onClick={() => setConfirm(true)}>Use this program</Button>}>
      <div className={styles.stack}>
        <SegmentedControl className={styles.goals} label="Goal" options={GOAL_OPTIONS} value={input.goal} onChange={(v) => set("goal", v as BuilderGoal)} />
        <SegmentedControl inline label="Days" options={DAY_OPTIONS} value={String(input.daysPerWeek)} onChange={(v) => set("daysPerWeek", Number(v) as DaysPerWeek)} />
        <SegmentedControl label="Equipment" options={EQUIPMENT_OPTIONS} value={input.equipment} onChange={(v) => set("equipment", v as EquipmentMode)} />
        <SegmentedControl label="Experience" options={EXPERIENCE_OPTIONS} value={input.experience} onChange={(v) => set("experience", v as BuilderInput["experience"])} />
        {week ? (
          <Panel sunken as="div">
            <ol className={styles.week} aria-label="Program preview">
              {WEEKDAYS.map((d) => (
                <li key={d} className={styles.day}>
                  <span className="ot-tag ot-ink-2">{d.slice(0, 3)}</span>
                  <span className={week[d].rest ? "ot-body ot-ink-2" : "ot-body-strong"}>{week[d].rest ? "Rest" : week[d].title}</span>
                </li>
              ))}
            </ol>
          </Panel>
        ) : (
          <p className={`ot-small ot-ink-2 ${styles.line}`}>No program fits these answers. Change one and try again.</p>
        )}
      </div>
      <Dialog
        id="generate"
        open={confirm}
        title="Generate new program?"
        body="Your current week stays until tomorrow."
        confirmLabel="Generate"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          if (week) onSave(week, input);
        }}
      />
    </Sheet>
  );
}
