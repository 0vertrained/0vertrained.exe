// src/programSessions.js
// ─────────────────────────────────────────────────────────────────────────────
// Optional AM/PM session adapter for weekly programs.
// Legacy program days keep the original shape: { lifting, cardio }.
// Session-aware days can add: { sessions: [{ id, label, title, lifting, cardio }] }.
// All helpers are pure and defensive so old saved programs continue to work.
// ─────────────────────────────────────────────────────────────────────────────

function cleanId(value, fallback) {
  const raw = String(value || "").trim().toLowerCase();
  const id = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id || fallback;
}

export function normalizeProgramSession(session = {}, index = 0, day = {}) {
  const fallbackId = index === 0 ? "main" : `session-${index + 1}`;
  const label = String(session.label || session.timeOfDay || (index === 0 ? "Session" : `Session ${index + 1}`)).trim();
  const id = cleanId(session.id || label, fallbackId);
  const title = String(session.title || session.type || day.type || label || "Training").trim();
  const lifting = Array.isArray(session.lifting) ? session.lifting : [];
  const cardio = session.cardio || null;
  return {
    id,
    label: label || (id === "main" ? "Session" : id.toUpperCase()),
    title,
    timeOfDay: session.timeOfDay || null,
    emphasis: session.emphasis || null,
    notes: session.notes || null,
    lifting,
    cardio,
  };
}

export function getProgramSessions(day = {}) {
  if (Array.isArray(day?.sessions) && day.sessions.length > 0) {
    return day.sessions.map((s, idx) => normalizeProgramSession(s, idx, day));
  }
  const lifting = Array.isArray(day?.lifting) ? day.lifting : [];
  const cardio = day?.cardio || null;
  if (!lifting.length && !cardio) return [];
  return [normalizeProgramSession({
    id: "main",
    label: "Session",
    title: day?.type || "Training",
    lifting,
    cardio,
  }, 0, day)];
}

export function usesProgramSessions(day = {}) {
  return Array.isArray(day?.sessions) && day.sessions.length > 0;
}

export function flattenProgramLifting(day = {}) {
  return getProgramSessions(day).flatMap((s) => Array.isArray(s.lifting) ? s.lifting : []);
}

export function getProgramCardioSessions(day = {}) {
  return getProgramSessions(day).filter((s) => !!s.cardio);
}

export function hasProgramTraining(day = {}) {
  return getProgramSessions(day).some((s) => (s.lifting || []).length > 0 || !!s.cardio);
}

export function countProgramSets(day = {}) {
  return flattenProgramLifting(day).reduce((sum, ex) => sum + (Number(ex?.sets) || 0), 0);
}

export function countProgramCardioMiles(day = {}) {
  return getProgramCardioSessions(day).reduce((sum, s) => sum + (Number(s.cardio?.miles) || 0), 0);
}

export function buildSplitSessionsFromLegacy(day = {}) {
  const lifting = Array.isArray(day.lifting) ? day.lifting : [];
  const midpoint = Math.ceil(lifting.length / 2);
  return {
    ...day,
    sessions: [
      {
        id: "am",
        label: "AM",
        title: `${day.type || "Training"} — AM`,
        timeOfDay: "morning",
        lifting: lifting.slice(0, midpoint),
        cardio: day.cardio || null,
      },
      {
        id: "pm",
        label: "PM",
        title: `${day.type || "Training"} — PM`,
        timeOfDay: "evening",
        lifting: lifting.slice(midpoint),
        cardio: null,
      },
    ],
    lifting: [],
    cardio: null,
  };
}

export function flattenProgramForLegacy(day = {}) {
  const sessions = getProgramSessions(day);
  return {
    ...day,
    sessions: undefined,
    lifting: sessions.flatMap((s) => s.lifting || []),
    cardio: sessions.find((s) => s.cardio)?.cardio || null,
  };
}
