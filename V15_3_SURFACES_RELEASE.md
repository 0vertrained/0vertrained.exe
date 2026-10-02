# 0VERTRAINED V15.3 — Surfaces: Palette, Settings, Coach

Fourth slice of the desktop arc. Below 1440px everything is byte-identical, per the established `display:contents` pattern and guards.

## Shipped

**⌘K command palette (1p, D4).** `src/ui/CommandPalette.jsx` — the FAB's QUICK_ACTIONS made desktop-native: ⌘K/Ctrl+K toggles (tier-only), number keys fire actions, first-letter keys jump tabs, Escape closes. The quick-action handler was lifted out of the sheet's inline prop into a shared `handleQuickAction`, so palette and mobile sheet dispatch identically — one behavior, two invocations.

**Settings two-pane (1m).** `300px | 1fr`: the section nav turns vertical and sticky on the left; content right. Mid-surgery the pane's closer landed before the content wrapper's and orphaned the Save bar outside the tree — both caught by the bundler before any commit, both fixed by reading the actual tail rather than guessing. The mockup's live theme miniatures are deferred (a picker rework, not a layout).

**Coach slide-over (1n).** The 85dvh bottom sheet becomes a 480px right slide-over at the tier — Today stays legible behind the scrim. Same component, one style ternary.

**Overlay contract fix.** Profile and Form Check overlays were rendering full-width inside the widened shell — a real V15.0-era gap. Both now center at `--ovt-content-width` at the tier.

## Already satisfied / honestly deferred

**Auth split (1s): already shipped.** The existing landing architecture *is* the mockup — LandingPage specimen left, sticky form right, two columns at desktop. No change made; credit where due to the V13-era design. **Profile hub (1l)** and the **Form-check workspace (1o)** are deferred, not slimmed: 1l needs a MoreTab restructure plus status plumbing (last-export, token state) that doesn't exist; 1o's stage/results seam crosses three component returns needing real mapping. Both tracked in the plan; both surfaces render correctly as centered reading columns meanwhile.

## Validation

Full gate green: 119 test files, lint 0 errors, both builds, secret scan. New static guards cover palette/settings/coach; **mounted-smoke debt logged** for the palette and two-pane (per the V15.1.1 policy — to land with V15.4's test pass). One process find: a mid-chain gate failure did not halt the `&&` chain (version bump ran anyway) — the gate script isn't propagating vitest's exit code; worth a look in `scripts/`. No migrations, no env changes.
