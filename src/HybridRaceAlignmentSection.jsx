import { useMemo, useState } from "react";
import { hybridAlignmentDecision, previewHybridRaceAlignment } from "./hybridRaceAlignment";
import { formatPlanDate } from "./RaceWeekLine";
import { isRunPlanSpec } from "./runPlanGenerator";
import { Sheet } from "./ui/ledger";

const FIRST_ROWS = 3;

function AlignmentPreview({ preview, align, saving, onCancel, onApply }) {
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const count = preview.changes.length;
  const visible = expanded ? preview.changes : preview.changes.slice(0, FIRST_ROWS);
  const apply = async () => {
    setFailed(false);
    if (!await onApply()) setFailed(true);
  };
  return (
    <Sheet open title="Preview lifting changes" onClose={onCancel}>
      <p className="t-bs">{align ? preview.raceName : "Original hybrid target"} · {formatPlanDate(preview.raceDate)}</p>
      <p className="t-s c2">Current taper target · {formatPlanDate(preview.currentRaceDate)}</p>
      <p className="t-s">Changes begin {formatPlanDate(preview.effectiveDate)}. {preview.unchangedRuns && "Your running schedule stays in place."}</p>
      <h3 className="t-bs">{count ? `${count} training ${count === 1 ? "day" : "days"} would change` : "Your scheduled workouts are the same"}</h3>
      {count > 0 && <ol className="rows" aria-label="Training days that would change">
        {visible.map(({ dateKey, before, after, liftChanges }) => <li className="kv" key={dateKey}>
          <time className="t-bs" dateTime={dateKey}>{formatPlanDate(dateKey)}</time>
          <p className="t-s c2"><b>Current</b> · {before}</p>
          <p className="t-s"><b>Proposed</b> · {after}</p>
          {liftChanges?.length > 0 && <details className="t-s">
            <summary>Exercise changes</summary>
            <ul className="lst">{liftChanges.map((line, index) => <li key={index}>{line}</li>)}</ul>
          </details>}
        </li>)}
      </ol>}
      {count > FIRST_ROWS && <button type="button" className="btn btn-s btn-sm" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? "Show fewer days" : `Show all ${count} days`}
      </button>}
      {failed && <p role="alert" className="t-s">Couldn’t save the change. Try applying it again.</p>}
      <button type="button" className="btn btn-p btn-b" disabled={saving} onClick={apply}>{saving ? "Saving…" : "Apply changes"}</button>
      <button type="button" className="btn btn-s" disabled={saving} onClick={onCancel}>Cancel</button>
    </Sheet>
  );
}

export function HybridRaceAlignment({ program, entries, todayKey, saving, setSaving, onSaveProgram }) {
  const choices = useMemo(() => ({
    align: hybridAlignmentDecision({ program, entries, todayKey, align: true }),
    restore: hybridAlignmentDecision({ program, entries, todayKey, align: false }),
  }), [program, entries, todayKey]);
  const [choice, setChoice] = useState(null);
  // A sync or date change invalidates the reviewed candidate before it can be saved.
  const preview = choice && choice.decision === choices[choice.mode] ? choice.preview : null;
  const race = isRunPlanSpec(program.__raceBuild) ? program.__raceBuild : null;
  if (!race && !choices.restore) return null;
  const open = mode => {
    const decision = choices[mode];
    const preview = previewHybridRaceAlignment({ program, entries, todayKey, align: mode === "align" }, decision);
    setChoice({ mode, decision, preview });
  };
  const close = () => { if (!saving) setChoice(null); };
  const save = async () => {
    if (saving || !preview) return false;
    setSaving(true);
    try {
      const savedMessage = choice.mode === "align" ? "Lifting aligned to race day" : "Original lifting dates restored";
      if (await onSaveProgram(preview.program, { savedMessage })) {
        setChoice(null);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally { setSaving(false); }
  };
  return (
    <section className="kv" aria-labelledby="hybrid-race-alignment" style={{ gap: 8 }}>
      <h3 id="hybrid-race-alignment" className="t-h">Race and lifting dates</h3>
      {race?.raceDate && <p className="t-s">{race.raceName} · {formatPlanDate(race.raceDate)}</p>}
      {race && !choices.align && !choices.restore && <p className="t-s c2">Alignment is available for an upcoming race scheduled on or after the block starts. Its race session must still be ahead.</p>}
      {choice && !preview && <p className="t-s c2" role="status">Your schedule changed. Preview the current dates before applying.</p>}
      {choices.align && <button type="button" className="btn btn-s" disabled={saving} onClick={() => open("align")}>Align lifting to this race</button>}
      {choices.restore && <button type="button" className="btn btn-s" disabled={saving} onClick={() => open("restore")}>Use original block dates</button>}
      {preview && <AlignmentPreview preview={preview} align={choice.mode === "align"} saving={saving} onApply={save} onCancel={close} />}
    </section>
  );
}
