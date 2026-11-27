import { DAYS, EQUIPMENT_COMBINATIONS, EQUIPMENT_OPTIONS, TRAINING_DAY_OPTIONS } from "./programBuilder";
import { exerciseTargetSummary } from "./workoutLogging";
import { FoldRow, RadioRows, Switch } from "./ui/ledger";

export function TrainingWeekdays({ input, onChange }) {
  const { restDays, trainingDaysPerWeek } = input;
  const toggle = (day) => {
    const next = restDays.includes(day) ? restDays.filter(d => d !== day) : [...restDays, day];
    onChange({ restDays: next, trainingDaysPerWeek: DAYS.length - next.length });
  };

  return (
    <div className="kv" style={{ gap: 6 }}>
      <span className="lbl">Training days</span>
      <div className="chips" role="group" aria-label="Training days">
        {DAYS.map(day => {
          const selected = !restDays.includes(day);
          const nextCount = trainingDaysPerWeek + (selected ? -1 : 1);
          return (
            <button key={day} type="button" className="chip" aria-label={day} aria-pressed={selected}
              disabled={!TRAINING_DAY_OPTIONS.includes(nextCount)} onClick={() => toggle(day)}>{day.slice(0, 3)}</button>
          );
        })}
      </div>
      <p className="t-s c2" aria-live="polite">{trainingDaysPerWeek} selected. Choose 2–6 days when you can train.</p>
    </div>
  );
}

export function BuilderEquipment({ id, equipment, choices = [], onChange }) {
  const toggle = value => {
    const equipmentChoices = choices.includes(value) ? choices.filter(item => item !== value) : [...choices, value];
    onChange({ equipmentChoices });
  };
  return (
    <div className="kv" style={{ gap: 8 }}>
      <RadioRows id={id} label="Equipment" options={EQUIPMENT_OPTIONS} value={equipment} onChange={value => onChange({ equipment: value })} />
      {equipment === "mixed" && (
        <div className="kv" style={{ gap: 6 }}>
          <span className="lbl">Available equipment</span>
          <div className="chips" role="group" aria-label="Available equipment">
            {EQUIPMENT_COMBINATIONS.map(item => (
              <button key={item.id} type="button" className="chip" aria-pressed={choices.includes(item.id)} onClick={() => toggle(item.id)}>{item.label}</button>
            ))}
          </div>
          {!choices.length && <p className="t-s c2">With no equipment selected, the plan uses floor exercises.</p>}
        </div>
      )}
    </div>
  );
}

export function AdaptiveLiftingChoice({ enabled, onChange }) {
  return (
    <div className="kv" style={{ gap: 4 }}>
      <div className="row" style={{ minHeight: 44 }}>
        <span className="t-bs grow">Adjust lifting targets</span>
        <Switch label="Adjust lifting targets" checked={enabled} onChange={onChange} />
      </div>
      <p className="t-s c2">{enabled
        ? "Choose your starting weight on a new lift. Later sessions use your completed sets and recovery to adjust working sets and weight targets."
        : "Use the working sets shown below and choose your own weights."}</p>
      {enabled && <a className="t-s" href="/training-guide.html#custom" target="_blank" rel="noreferrer">How your targets change ↗</a>}
    </div>
  );
}

export function BuilderWeekPreview({ plan, summary, id }) {
  return (
    <section aria-labelledby={id} className="kv" style={{ gap: 4 }}>
      <h3 id={id} className="t-h">Your week</h3>
      <p className="t-s c2">{summary.headline}{summary.totalWeeklySets > 0 && ` · ${summary.totalWeeklySets} starting work sets`}</p>
      <ol className="rows">
        {summary.days.map(d => {
          if (d.isRest) return <li className="row t-s c2" key={d.day}>{d.day} · Rest</li>;
          const { lifting, cardio } = plan.program[d.day];
          return (
            <FoldRow key={d.day} title={`${d.day} · ${d.type}`} sub={d.label}>
              {lifting.map(exercise => (
                <div className="kv" key={exercise.name}>
                  <span className="t-bs">{exercise.name}</span>
                  <span className="t-s c2">{exerciseTargetSummary(exercise)}</span>
                </div>
              ))}
              {cardio && (
                <div className="kv">
                  <span className="t-bs">{cardio.type}</span>
                  <span className="t-s c2">{[cardio.minutes > 0 && `${cardio.minutes} min`, cardio.miles > 0 && `${cardio.miles} mi`, cardio.effort].filter(Boolean).join(" · ")}</span>
                  {cardio.notes && <p className="t-s">{cardio.notes}</p>}
                </div>
              )}
            </FoldRow>
          );
        })}
      </ol>
    </section>
  );
}
