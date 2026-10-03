// Stable element ids derived from a control's label ("Rest-timer sound" →
// "ot-switch-rest-timer-sound"), so label/for and aria-labelledby pairs hold
// across renders without the caller passing an `id`.
export function labelId(prefix: string, label: string): string {
  return `${prefix}-${label.replace(/\W+/g, "-").toLowerCase()}`;
}
