// The import preview: what the chosen file is, how many days it holds and
// from when to when, anything that was skipped, and the one choice that
// matters (add only what is missing, or replace everything) before Import.
import { useState } from "react";
import { Button } from "../../design/Button";
import { SegmentedControl } from "../../design/SegmentedControl";
import { Sheet } from "../../design/Sheet";
import type { ImportKind, ImportMode, ImportParse } from "../../data/legacyImport";
import styles from "./ProgramSheets.module.css";
import { shortDate } from "./profileView";

export interface ImportSheetProps {
  parsed: ImportParse;
  /** Days the file would add in missing-only mode. */
  added: number;
  busy?: boolean;
  onImport: (mode: ImportMode) => void;
  onClose: () => void;
}

const KIND_LABEL: Readonly<Record<ImportKind, string>> = {
  "backup-v2": "0VERTRAINED backup",
  "backup-v1": "Backup from the previous version",
  "raw-map": "Day log from the previous version",
  unknown: "Not a backup",
};

const MODE_OPTIONS = [
  { value: "missing-only", label: "Add missing days only" },
  { value: "replace", label: "Replace everything" },
] as const;

const plural = (n: number, word: string): string => `${n} ${n === 1 ? word : `${word}s`}`;

export function ImportSheet({ parsed, added, busy, onImport, onClose }: ImportSheetProps) {
  const [mode, setMode] = useState<ImportMode>("missing-only");
  const usable = parsed.kind !== "unknown";
  const effect = mode === "replace"
    ? `${plural(parsed.counts.days, "day")} replace your log${parsed.program ? " and program" : ""}.`
    : `${plural(added, "new day")} added. Days you already have stay as they are.`;
  return (
    <Sheet id="import" title="Import backup" onClose={onClose} footer={<Button variant="primary" full disabled={!usable || busy} loading={busy} onClick={() => onImport(mode)}>Import</Button>}>
      <div className={styles.stack}>
        <div className={styles.summary}>
          <p className="ot-body-strong">{KIND_LABEL[parsed.kind]}</p>
          {usable ? <p className="ot-body"><span className="ot-numeral">{parsed.counts.days}</span> {parsed.counts.days === 1 ? "day" : "days"}{parsed.program ? " and a program" : ""}</p> : null}
          {parsed.range ? <p className="ot-caption ot-ink-2">{shortDate(parsed.range.from)} – {shortDate(parsed.range.to)}</p> : null}
        </div>
        {parsed.warnings.length > 0 ? (
          <ul className={`ot-small ot-ink-2 ${styles.warnings}`} aria-label="Notes">
            {parsed.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        ) : null}
        {usable ? (
          <>
            <SegmentedControl label="Mode" options={[...MODE_OPTIONS]} value={mode} onChange={(v) => setMode(v as ImportMode)} />
            <p className={`ot-small ot-ink-2 ${styles.line}`}>{effect}</p>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
