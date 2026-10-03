// Three sheets, under a minute: what you train for and how often; what you
// train with, your experience, units and bodyweight; then the week the
// generator made, and Start. Writes nothing until Start.
import { useState } from "react";
import { Button } from "../../design/Button";
import { Panel } from "../../design/Panel";
import { SegmentedControl } from "../../design/SegmentedControl";
import { Sheet } from "../../design/Sheet";
import { TextInput } from "../../design/TextInput";
import { Wordmark } from "../../design/Wordmark";
import { WEEKDAYS } from "../../domain/dates";
import type { DaysPerWeek } from "../../domain/program/types";
import styles from "./OnboardingFlow.module.css";
import {
  bodyweightKgFrom, DAY_OPTIONS, EQUIPMENT_OPTIONS, EXPERIENCE_OPTIONS, GOAL_OPTIONS, ONBOARDING_DEFAULTS, previewWeek,
  type OnboardingAnswers,
} from "./plan";

export interface OnboardingFlowProps {
  onComplete: (answers: OnboardingAnswers) => void;
  onCancel: () => void;
}

const TITLES = ["What are you training for?", "What do you train with?", "Your first week"];

export function OnboardingFlow({ onComplete, onCancel }: OnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>(ONBOARDING_DEFAULTS);
  const [bodyweight, setBodyweight] = useState("");
  const set = <K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) => setAnswers((a) => ({ ...a, [key]: value }));
  const week = step === 2 ? previewWeek(answers) : null;
  const unitLabel = answers.units === "imperial" ? "lb" : "kg";

  const finish = () => {
    const kg = bodyweightKgFrom(bodyweight, answers.units);
    onComplete(kg === undefined ? answers : { ...answers, bodyweightKg: kg });
  };

  const footer = step < 2
    ? <Button variant="primary" full onClick={() => setStep(step + 1)}>Next</Button>
    : <Button variant="primary" full onClick={finish}>Start</Button>;

  return (
    <div className={styles.backdrop}>
      <div className={styles.mark}><Wordmark size={28} /></div>
      <Sheet id={`onboarding-${step}`} title={TITLES[step] ?? ""} onClose={step === 0 ? onCancel : () => setStep(step - 1)} footer={footer}>
        <p className={`ot-caption ot-ink-3 ${styles.stepLine}`}>Step {step + 1} of 3</p>
        {step === 0 ? (
          <div className={styles.stack}>
            <SegmentedControl className={styles.goals} label="Goal" options={GOAL_OPTIONS} value={answers.goal} onChange={(v) => set("goal", v as OnboardingAnswers["goal"])} />
            <SegmentedControl inline label="Days" options={DAY_OPTIONS} value={String(answers.daysPerWeek)} onChange={(v) => set("daysPerWeek", Number(v) as DaysPerWeek)} />
          </div>
        ) : null}
        {step === 1 ? (
          <div className={styles.stack}>
            <SegmentedControl label="Equipment" options={EQUIPMENT_OPTIONS} value={answers.equipment} onChange={(v) => set("equipment", v as OnboardingAnswers["equipment"])} />
            <SegmentedControl label="Experience" options={EXPERIENCE_OPTIONS} value={answers.experience} onChange={(v) => set("experience", v as OnboardingAnswers["experience"])} />
            <SegmentedControl inline label="Units" options={[{ value: "metric", label: "kg · km" }, { value: "imperial", label: "lb · mi" }]} value={answers.units} onChange={(v) => set("units", v as OnboardingAnswers["units"])} />
            <TextInput label={`Bodyweight (${unitLabel}), optional`} inputMode="decimal" placeholder={answers.units === "imperial" ? "e.g. 176" : "e.g. 80"} value={bodyweight} onChange={setBodyweight} hint="Used for the STR stat. You can add it later." />
          </div>
        ) : null}
        {step === 2 && week ? (
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
        ) : null}
      </Sheet>
    </div>
  );
}
