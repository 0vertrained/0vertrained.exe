/** Joins truthy class names: cx("ot-btn", full && "ot-btn-full"). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
