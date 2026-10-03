// The preset picker: every ready-made week as a row (name, description,
// tags); picking one asks once, then the caller records it from tomorrow.
import { useState } from "react";
import { Dialog } from "../../design/Dialog";
import { Sheet } from "../../design/Sheet";
import { PRESETS, type Preset } from "../../domain/program/presets";
import styles from "./ProgramSheets.module.css";

export interface PresetSheetProps {
  /** The preset the current week came from, if any; marked in the list. */
  currentId?: string;
  onSave: (preset: Preset) => void;
  onClose: () => void;
}

export function PresetSheet({ currentId, onSave, onClose }: PresetSheetProps) {
  const [chosen, setChosen] = useState<Preset | null>(null);
  return (
    <Sheet id="preset" title="Switch preset" onClose={onClose}>
      <ul className={styles.presets} aria-label="Presets">
        {PRESETS.map((p) => (
          <li key={p.id}>
            <button type="button" className={styles.preset} aria-current={p.id === currentId ? "true" : undefined} onClick={() => setChosen(p)}>
              <span className={`ot-body-strong ${styles.name}`}>{p.name}</span>
              <span className="ot-small ot-ink-2">{p.description}</span>
              <span className="ot-tag ot-ink-3">{p.tags.join(" · ")}</span>
            </button>
          </li>
        ))}
      </ul>
      <Dialog
        id="switch-preset"
        open={chosen !== null}
        title="Switch preset?"
        body="Your current week stays until tomorrow."
        confirmLabel="Switch preset"
        onCancel={() => setChosen(null)}
        onConfirm={() => {
          if (chosen) onSave(chosen);
        }}
      />
    </Sheet>
  );
}
