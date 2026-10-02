// src/appShellStyle.js
// Bottom padding for the app shell. S.app reserves ~80px for the fixed BottomNav
// dock (plus the device safe-area inset). Full-screen overlays — Profile and
// Form Check — replace the tab content and hide that dock, so the 80px
// reservation becomes dead space at the end of a scroll. While an overlay is
// active we drop the dock reservation and keep only the safe-area inset; regular
// tabs keep the full clearance so content never hides behind the dock.
export function appShellStyle(baseAppStyle, overlayActive) {
  if (!overlayActive) return baseAppStyle;
  return { ...baseAppStyle, paddingBottom: "env(safe-area-inset-bottom, 0px)" };
}
