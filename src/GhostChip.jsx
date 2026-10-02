// src/GhostChip.jsx
// ─────────────────────────────────────────────────────────────────────────────
// V17.5 · The ghost chip — one tap fills the set.
// Quiet by design: faint mono, a single hairline, sits under the first empty
// row only (setGhosts.firstEmptyIndex decides placement, not this component).
// Says its source out loud so the suggestion can be audited at a glance.
// ─────────────────────────────────────────────────────────────────────────────
import { useTheme } from "./theme";

export function GhostChip({ ghost, onFill, compact = false }) {
  const { C } = useTheme();
  if (!ghost || !parseFloat(ghost.weight)) return null;
  const mono = C.monoFamily || C.fontFamily;
  return (
    <button
      type="button"
      data-testid="ghost-chip"
      onClick={() => onFill({ weight: ghost.weight, reps: ghost.reps })}
      aria-label={`Fill set with ${ghost.weight} pounds for ${ghost.reps || "planned"} reps (${ghost.label})`}
      style={{
        display: "flex", alignItems: "baseline", gap: 8,
        width: "100%", textAlign: "left",
        background: "none", border: "none", borderBottom: `1px dashed ${C.line}`,
        cursor: "pointer", padding: compact ? "3px 4px 5px" : "3px 8px 6px",
      }}
    >
      <span style={{ fontFamily: mono, fontSize: 11, color: C.textDim, letterSpacing: "0.03em" }}>
        ⌁ {parseFloat(ghost.weight)} × {parseFloat(ghost.reps) || "·"}
      </span>
      <span style={{ fontFamily: mono, fontSize: 9, color: C.textFaint, letterSpacing: "0.06em", textTransform: "lowercase" }}>
        tap to fill · {ghost.label}
      </span>
    </button>
  );
}

export default GhostChip;
