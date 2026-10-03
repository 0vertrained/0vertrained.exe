// The stat explain sheet: the formula in plain words, the inputs behind
// today's value as label/value rows, the four-week line, and the same four
// values as a visually-hidden table so a screen reader gets what the
// sparkline draws. No primary: Close is the way out.
import { Sheet } from "../../design/Sheet";
import { Sparkline } from "../../design/Sparkline";
import type { Explain } from "./statsView";
import styles from "./StatsSheets.module.css";

export interface ExplainPoint {
  /** "Fri 2 Oct" */
  label: string;
  value: number;
}

export interface ExplainSheetProps {
  explain: Explain;
  /** The four weekly points, oldest first. */
  points: ExplainPoint[];
  onClose: () => void;
}

export function ExplainSheet({ explain, points, onClose }: ExplainSheetProps) {
  const id = `explain-${explain.name.toLowerCase()}`;
  return (
    <Sheet id={id} title={explain.name} onClose={onClose}>
      <p className={`ot-body ${styles.line}`}>{explain.formula}</p>
      <ul className={styles.inputs} aria-label={`${explain.name} inputs`}>
        {explain.inputs.map((i) => (
          <li key={i.label} className={styles.input}>
            <span className="ot-small ot-ink-2">{i.label}</span>
            <span className="ot-numeral">{i.value}</span>
          </li>
        ))}
      </ul>
      <div className={styles.spark}>
        <Sparkline data={points.map((p) => p.value)} width={320} height={48} />
      </div>
      <table className="ot-visually-hidden">
        <caption>{explain.name} by week</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">{explain.name}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              <td>{p.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  );
}
