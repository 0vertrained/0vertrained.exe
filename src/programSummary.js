// Shared day labels for Today and Coach, including separate morning and evening sessions.
import { getProgramSessions } from "./programSessions";

function describeCardio(cardio) {
  const type = typeof cardio.type === "string" ? cardio.type.trim() : "";
  const effort = typeof cardio.effort === "string" ? cardio.effort.trim() : "";
  const minutes = Number(cardio.minutes);
  const miles = Number(cardio.miles);
  const parts = type ? [type] : [];
  // Time-based race prescriptions carry an estimated distance. Show the prescribed time.
  if (Number.isFinite(minutes) && minutes > 0) {
    parts.push(`${minutes} min`);
    if (effort && !type.toLowerCase().includes(effort.toLowerCase())) parts.push(effort);
  } else {
    if (Number.isFinite(miles) && miles > 0) parts.push(`${miles}mi`);
    if (effort) parts.push(effort);
  }
  return { type, label: parts.join(" · ") || "Cardio" };
}

export function summarizeProgramDay(day = null) {
  const sessions = getProgramSessions(day);
  const liftCount = sessions.reduce((count, session) => count + session.lifting.length, 0);
  const hasLifting = liftCount > 0;
  const cardios = sessions.filter(session => session.cardio).map(session => describeCardio(session.cardio));
  const hasCardio = cardios.length > 0;
  const cardioLabel = cardios.map(cardio => cardio.label).join(" + ") || null;
  const type = typeof day?.type === "string" ? day.type.trim() : "";
  const labels = type ? [type] : hasLifting ? [`${liftCount} lift${liftCount === 1 ? "" : "s"}`] : [];
  for (const cardio of cardios) {
    if (!type || !type.toLowerCase().includes(cardio.type.toLowerCase())) labels.push(cardio.label);
  }
  return { label: labels.join(" + ") || "Rest / mobility", hasLifting, hasCardio, liftCount, cardioLabel };
}
