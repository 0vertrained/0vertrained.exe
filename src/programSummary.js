// src/programSummary.js
// Pure display helpers for weekly program days. Keeps Today/Coach labels aligned
// with what the Program editor saves: lifting + optional cardio.

const finiteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function summarizeProgramDay(day = null) {
  if (!day) {
    return {
      label: "Rest / mobility",
      hasLifting: false,
      hasCardio: false,
      liftCount: 0,
      cardioLabel: null,
    };
  }

  const lifting = Array.isArray(day.lifting) ? day.lifting : [];
  const liftCount = lifting.length;
  const hasLifting = liftCount > 0;
  const cardio = day.cardio || null;
  const hasCardio = Boolean(cardio);
  const type = typeof day.type === "string" && day.type.trim() ? day.type.trim() : null;
  const cardioType = typeof cardio?.type === "string" && cardio.type.trim() ? cardio.type.trim() : null;
  const miles = finiteNumber(cardio?.miles);
  const effort = typeof cardio?.effort === "string" && cardio.effort.trim() ? cardio.effort.trim() : null;

  const cardioParts = [];
  if (cardioType) cardioParts.push(cardioType);
  if (miles !== null && miles > 0) cardioParts.push(`${miles}mi`);
  if (effort) cardioParts.push(effort);
  const cardioLabel = hasCardio ? (cardioParts.join(" · ") || "Cardio") : null;

  let label;
  if (type && cardioLabel && !type.toLowerCase().includes((cardioType || "").toLowerCase())) {
    label = `${type} + ${cardioLabel}`;
  } else if (type) {
    label = type;
  } else if (cardioLabel && hasLifting) {
    label = `${liftCount} lift${liftCount === 1 ? "" : "s"} + ${cardioLabel}`;
  } else if (cardioLabel) {
    label = cardioLabel;
  } else if (hasLifting) {
    label = `${liftCount} lift${liftCount === 1 ? "" : "s"}`;
  } else {
    label = "Rest / mobility";
  }

  return { label, hasLifting, hasCardio, liftCount, cardioLabel };
}
