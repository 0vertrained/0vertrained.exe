// src/editionWindow.js
// When the Sunday Edition is out. Kept apart from the edition's model so the
// shell can ask "is one out?" without loading the model with it.

const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The edition window for a given moment. Always describes the most recently
 * COMPLETED Mon–Sun week; `available` gates the UI (Sun 17:00 → Mon 23:59).
 */
export function editionWindow(now = new Date()) {
  const n = new Date(now);
  const day = n.getDay(); // 0 = Sunday
  // The Sunday that closes the edition week:
  const sunday = new Date(n);
  if (day === 0) {
    // Today is Sunday. Before 17:00 the closing Sunday is LAST week's.
    if (n.getHours() < 17) sunday.setDate(n.getDate() - 7);
  } else {
    sunday.setDate(n.getDate() - day); // most recent past Sunday
  }
  sunday.setHours(12, 0, 0, 0);
  const monday = new Date(sunday);
  monday.setDate(sunday.getDate() - 6);
  const available =
    (day === 0 && n.getHours() >= 17) || // Sunday evening
    day === 1;                            // all of Monday
  return {
    available,
    weekStartKey: keyOf(monday),
    weekEndKey: keyOf(sunday),
    label: `${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${sunday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
  };
}
