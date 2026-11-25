// src/GhostChip.jsx
// The ghost: one tap fills the set with a suggested load and reps.
// It sits under the first empty row only (setGhosts.firstEmptyIndex decides
// placement, not this component) and says where the suggestion comes from, so
// it can be checked at a glance.

export function GhostChip({ ghost, onFill, compact = false }) {
  if (!ghost || !parseFloat(ghost.weight)) return null;
  return (
    <button
      type="button"
      className="ghost"
      data-testid="ghost-chip"
      onClick={() => onFill({ weight: ghost.weight, reps: ghost.reps })}
      aria-label={`Fill set with ${ghost.weight} pounds for ${ghost.reps || "planned"} reps (${ghost.label})`}
      style={compact ? { paddingLeft: 0 } : undefined}
    >
      <span className="n-s">{parseFloat(ghost.weight)}{"\u00a0"}×{"\u00a0"}{parseFloat(ghost.reps) || "·"}</span>
      <span className="t-s c2 grow clip">{ghost.label}</span>
      <span className="t-s u">tap to fill</span>
    </button>
  );
}

export default GhostChip;
