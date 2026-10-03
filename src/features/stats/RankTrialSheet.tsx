// The Rank Trial sheet: the target rank's badge beside a brass "[Rank Trial]"
// tag, the prescription in numeral, the safety line in body-strong every
// time, the full day it attaches to, and the reward line. "Got it" is the
// sheet's one primary and closes it; the trial itself is attached by the
// check-in on that day.
import { Button } from "../../design/Button";
import { RankBadge } from "../../design/RankBadge";
import { Sheet } from "../../design/Sheet";
import type { DateKey } from "../../domain/dates";
import type { TrialSpec } from "../../domain/game/types";
import { SAFETY_LINE, shortDate, TRIAL_REWARD, trialPrescription } from "./statsView";
import styles from "./StatsSheets.module.css";

export interface RankTrialSheetProps {
  trial: TrialSpec;
  /** The planned day the trial attaches to; null when none is in sight. */
  attachKey: DateKey | null;
  onClose: () => void;
}

/** "Attaches to Tue 7 Oct, your next full day with Back Squat." */
export function attachLine(trial: TrialSpec, attachKey: DateKey | null): string {
  if (attachKey === null || trial.exerciseName === null) return "Attaches to your next full day.";
  return `Attaches to ${shortDate(attachKey)}, your next full day with ${trial.exerciseName}.`;
}

export function RankTrialSheet({ trial, attachKey, onClose }: RankTrialSheetProps) {
  const title = (
    <span className={styles.title}>
      <span className="ot-tag ot-brass">[Rank Trial]</span>
      <RankBadge rank={trial.targetRank} size="md" />
    </span>
  );
  return (
    <Sheet id="trial" title={title} onClose={onClose} footer={<Button variant="primary" full onClick={onClose}>Got it</Button>}>
      <p className={`ot-numeral ${styles.line}`}>{trialPrescription(trial)}</p>
      <p className={`ot-body-strong ${styles.line}`}>{SAFETY_LINE}</p>
      <p className={`ot-body ot-ink-2 ${styles.line}`}>{attachLine(trial, attachKey)}</p>
      <p className={`ot-small ot-ink-2 ${styles.line}`}>{TRIAL_REWARD}</p>
    </Sheet>
  );
}
