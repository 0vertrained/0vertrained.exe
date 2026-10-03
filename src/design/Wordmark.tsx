// The name in the mono at 600 with the leading zero in brass and the rest in
// ink. The zero is the mark ("zero overtraining") and the only brass glyph
// that stands alone without having been earned. `size` in px: 56 on the
// landing page, 28 on the sign-in sheet; the status strip never shows it.
// Never recolour the zero, never set the name in the sans.
import { cx } from "./cx";

export interface WordmarkProps {
  /** Font size in px; the mark is 1em tall. */
  size?: number;
  className?: string;
}

export function Wordmark({ size, className }: WordmarkProps) {
  return (
    <span className={cx("ot-wordmark", className)} style={size ? { fontSize: size } : undefined} role="img" aria-label="0VERTRAINED">
      <span className="ot-wordmark-zero" aria-hidden="true">0</span>
      <span aria-hidden="true">VERTRAINED</span>
    </span>
  );
}
