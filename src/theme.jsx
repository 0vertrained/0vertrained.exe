import { createContext, useContext, useMemo } from "react";

export const THEME_NAMES = ["whitepaperLight", "whitepaperDark", "terminal"];

// Themes shown in Settings (terminal retained as a legacy option).
export const PRIMARY_THEMES = ["whitepaperLight", "whitepaperDark"];

// ── Terminal palette (legacy, retained for backwards compatibility) ────────────
const TERMINAL = {
  id: "terminal",
  label: "Terminal",
  desc: "Dark · monospace · precision",
  mono: true,
  serif: false,
  fontFamily: "'IBM Plex Mono', 'DM Mono', monospace",
  serifFamily: "'IBM Plex Mono', monospace",
  monoFamily: "'IBM Plex Mono', monospace",
  bg:        "#07090a",
  panel:     "#090c0d",
  block:     "#0a100d",
  cell:      "#0c1310",
  line:      "#14201b",
  lineBright:"#1a2a20",
  green:     "#5fd68a",
  greenDim:  "#2a5d3e",
  greenDark: "#0d1f14",
  greenMid:  "#4a9d6e",
  text:      "#e8efe8",
  textDim:   "#4a6d5a",
  textFaint: "#3a5d4a",
  blue:      "#4a9de8",
  blueDim:   "#1a3a4a",
  amber:     "#e8c547",
  red:       "#e85a5a",
  signal:    "#e85a5a",
  // UI specific
  navInactiveTxt: "#2a4a3a",
  inputBg:        "#0c1310",
  cardBg:         "#0a100d",
  cardRadius:     0,
  inputRadius:    0,
  pillRadius:     0,
  setDoneBg:      "#0d1f14",
  setDoneBorder:  "#2a5d3e",
  setDoneText:    "#5fd68a",
};

// ── Whitepaper Light: Paper theme with ink-based UI ──────────────────────────
// Light stock: warm white paper background, ink primary text, hairline rules.
const WHITEPAPER_LIGHT = {
  id: "whitepaperLight",
  label: "Paper",
  desc: "Light · ink · ruled",
  mono: false,
  serif: true,
  fontFamily: "'IBM Plex Sans', 'Inter', sans-serif",
  serifFamily: "'Newsreader', Georgia, serif",
  monoFamily: "'IBM Plex Mono', monospace",
  // Light paper stock with warm tone
  bg:        "#FAF9F6",  // warm white paper
  panel:     "#FFFFFF",  // surface white
  block:     "#FFFFFF",  // block white
  cell:      "#FFFFFF",  // cell white
  line:      "#E6E3DB",  // hairline rule (warm beige)
  lineBright:"#DDD9CF",  // slightly darker hairline
  // Ink tones (no color, single-ink language)
  green:     "#1A1A1A",  // primary ink (black)
  greenDim:  "#67655E",  // secondary ink (warm gray)
  greenDark: "#E6E3DB",  // highlight surface (hairline tone)
  greenMid:  "#3A3A3A",  // mid ink
  text:      "#1A1A1A",  // primary ink
  textDim:   "#67655E",  // secondary ink (warm gray)
  textFaint: "#767368",  // faint ink (light gray) · 4.5:1 on paper (WCAG AA)
  blue:      "#1A1A1A",  // same as green, no color distinction
  blueDim:   "#E6E3DB",  // hairline tone
  amber:     "#1A1A1A",  // monochrome error (ink)
  red:       "#B23A1E",  // error ink (muted warm red for error states only)
  signal:    "#B23A1E",
  // UI specific
  navInactiveTxt: "#767368",
  inputBg:        "#FFFFFF",
  cardBg:         "#FFFFFF",
  cardRadius:     2,
  inputRadius:    2,
  pillRadius:     4,
  setDoneBg:      "#FAF9F6",
  setDoneBorder:  "#E6E3DB",
  setDoneText:    "#1A1A1A",
};

// ── Whitepaper Dark: Negative theme with inverted ink structure ───────────────
// Dark stock: warm near-black, inverted ink light (off-white), same hairline rules.
const WHITEPAPER_DARK = {
  id: "whitepaperDark",
  label: "Negative",
  desc: "Dark · ink · ruled",
  mono: false,
  serif: true,
  fontFamily: "'IBM Plex Sans', 'Inter', sans-serif",
  serifFamily: "'Newsreader', Georgia, serif",
  monoFamily: "'IBM Plex Mono', monospace",
  // Dark warm stock (near-black)
  bg:        "#141311",  // warm near-black stock
  panel:     "#1C1B18",  // warm surface
  block:     "#1C1B18",  // block surface
  cell:      "#1C1B18",  // cell surface
  line:      "#2E2A26",  // hairline rule (warm gray)
  lineBright:"#3A3632",  // slightly lighter hairline
  // Inverted ink tones (light ink on dark stock)
  green:     "#F1EFE8",  // primary ink (off-white)
  greenDim:  "#9C988C",  // secondary ink (warm light gray)
  greenDark: "#2E2A26",  // highlight surface (hairline tone)
  greenMid:  "#D4D0C8",  // mid ink (lighter gray)
  text:      "#F1EFE8",  // primary ink (off-white)
  textDim:   "#9C988C",  // secondary ink (warm light gray)
  textFaint: "#8A867C",  // faint ink (medium gray) · 5.1:1 on stock (WCAG AA)
  blue:      "#F1EFE8",  // same as green, no color distinction
  blueDim:   "#2E2A26",  // hairline tone
  amber:     "#F1EFE8",  // monochrome (ink)
  red:       "#EE8160",  // error ink (warm muted coral)
  signal:    "#EE8160",
  // UI specific
  navInactiveTxt: "#8A867C",
  inputBg:        "#1C1B18",
  cardBg:         "#1C1B18",
  cardRadius:     2,
  inputRadius:    2,
  pillRadius:     4,
  setDoneBg:      "#141311",
  setDoneBorder:  "#2E2A26",
  setDoneText:    "#F1EFE8",
};

export const THEMES = {
  whitepaperLight: WHITEPAPER_LIGHT,
  whitepaperDark: WHITEPAPER_DARK,
  // Backwards-compatible aliases for saved settings from previous builds.
  instrument: WHITEPAPER_DARK,
  instrumentLight: WHITEPAPER_LIGHT,
  terminal: TERMINAL,
};

// ── Build style objects from a palette ────────────────────────────────────────
// ─── Interaction verb system (V6) ─────────────────────────────────────────────
// One rule set for what each interactive style MEANS, app-wide:
//   · Primary action   — filled button (bg C.text, text C.bg). One per view max.
//   · Secondary action — ghost/outline button (S.smallBtn / btn-ghost style).
//   · Disclosure       — "▾ label" / "▲ hide" toggle rows; expands in place.
//   · Navigation       — "label →" rows/buttons; leaves the current view.
//   · blockStat slots  — right side of a blockHead carries DATA (counts,
//     ratios, dates) or nothing. Never decorative labels.
// New UI should pick from these five, not invent a sixth.
export function buildStyles(C) {
  const mono = C.fontFamily;                       // primary UI font (IBM Plex Sans)
  const serif = C.serifFamily || C.fontFamily;     // serif for display (Newsreader)
  const annot = C.monoFamily || C.fontFamily;      // mono for annotations (IBM Plex Mono)
  // Tabular figures: live-updating numbers should align in columns and not
  // jitter in width as their digits change.
  const TNUM = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum"' };
  return {
    // ── design-token accessors (Slice 2) ──
    // Spacing and type-scale values surfaced from TOKENS so components can read a
    // shared rhythm off the S object instead of hardcoding pixel values. Purely
    // additive — no existing style depends on these.
    gap:     TOKENS.spacing.sm,        // 8
    gapMd:   TOKENS.spacing.md,        // 12
    gapLg:   TOKENS.spacing.lg,        // 16
    gapXl:   TOKENS.spacing.xl,        // 24
    textXs:   TOKENS.typeScale.micro,     // 7
    textSm:   TOKENS.typeScale.caption,   // 9
    textBody: TOKENS.typeScale.body,      // 11
    textMd:   TOKENS.typeScale.bodyLarge, // 13
    textLg:   TOKENS.typeScale.title,     // 18
    textXl:   TOKENS.typeScale.hero,      // 26
    // ── design-language helpers (used by Whitepaper themes) ──
    fontMain:  mono,
    fontSerif: serif,
    fontAnnot: annot,
    isSerif:   !!C.serif,
    // serif accent: display text, big numbers
    serifAccent: { fontFamily: serif, fontStyle: "normal", color: C.text },
    // the θVERTRAINED wordmark: italic serif θ + sans for the rest
    wordmark: { fontFamily: mono, fontWeight: 700, letterSpacing: "-0.01em", color: C.text, display: "inline-flex", alignItems: "baseline" },
    wordmarkTheta: { fontFamily: serif, fontStyle: "italic", fontWeight: 500, color: C.text },
    // figure captions and labels (monospace, small)
    figureCaption: { fontFamily: annot, fontSize: 11, color: C.textDim, letterSpacing: "0.05em", textTransform: "uppercase", marginTop: 8 },
    // monospace system annotation (// derived · reconciled)
    annotation: { fontFamily: annot, fontSize: 10.5, color: C.textFaint, letterSpacing: "0.03em" },
    // telemetry label: uppercase, tracked, muted
    telemetryLabel: { fontFamily: annot, fontSize: 10.5, color: C.textFaint, letterSpacing: "0.08em", textTransform: "uppercase" },
    // source tag for imported data
    sourceTag: { fontFamily: annot, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 0, background: C.lineBright, color: C.text, border: `1px solid ${C.line}` },
    app: { background: C.bg, minHeight: "100dvh", fontFamily: mono, color: C.text, maxWidth: "var(--ovt-shell-width, var(--ovt-content-width))", margin: "0 auto", paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px))", position: "relative" },
    // Header: slim ruled top with metadata and title
    header: { padding: "12px 16px 10px", borderBottom: `1px solid ${C.line}`, background: C.panel, position: "sticky", top: 0, zIndex: 100 },
    hTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
    // Date/time metadata row
    eyebrow: { fontSize: 10, letterSpacing: "0.25em", color: C.textFaint, textTransform: "uppercase" },
    titleRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 2 },
    // Display serif headline
    title: { fontSize: 28, fontWeight: 500, fontFamily: serif, color: C.text, letterSpacing: "-0.02em", textTransform: "none" },
    dayCode: { fontSize: 10, color: C.textDim, letterSpacing: "0.1em", ...TNUM },
    // Whitepaper figure plate: every major UI group is a ruled figure, not a card.
    block: { borderBottom: `1px solid ${C.line}`, padding: "15px 16px 14px", borderTop: `1px solid ${C.line}`, background: C.bg },
    // Section heads should guide the eye without acting like hard page breaks.
    // The parent block's borderTop already provides the top rule, so blockHead
    // carries no borderTop of its own — this avoids a double hairline at the
    // top of every ruled section.
    blockHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 12, paddingTop: 4 },
    // Figure label: Fig. N · Name / ledger caption
    blockTitle: { fontFamily: annot, fontSize: 10.5, letterSpacing: "0.14em", color: C.textDim, textTransform: "uppercase", fontWeight: 500 },
    blockStat: { fontFamily: annot, fontSize: 11, color: C.textFaint, letterSpacing: "0.08em", textTransform: "uppercase", ...TNUM },
    figurePlate: { borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, padding: "12px 0", background: C.bg },
    figureRule: { height: 1, background: C.line, width: "100%" },
    leadFigure: { fontFamily: serif, fontSize: 54, lineHeight: 0.9, fontWeight: 500, color: C.text, letterSpacing: "-0.045em", ...TNUM },
    leadUnit: { fontFamily: annot, fontSize: 11, color: C.textFaint, letterSpacing: "0.08em", textTransform: "uppercase", marginLeft: 4 },
    ruledRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "7px 0", borderBottom: `1px solid ${C.line}` },
    ruledLabel: { fontFamily: annot, fontSize: 11, color: C.textDim, letterSpacing: "0.11em", textTransform: "uppercase" },
    ruledValue: { fontFamily: annot, fontSize: 13, color: C.text, letterSpacing: "0.02em", textAlign: "right", ...TNUM },
    metricLedger: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, background: C.bg },
    metricLedgerCell: { padding: "9px 8px", borderRight: `1px solid ${C.line}`, minWidth: 0 },
    metricLedgerValue: { fontFamily: serif, fontSize: 24, lineHeight: 1, fontWeight: 500, color: C.text, letterSpacing: "-0.035em", ...TNUM },
    metricLedgerLabel: { fontFamily: annot, fontSize: 10, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 4 },
    // Exercise name (serif for display, monospace option for compact)
    exName: { fontSize: 14, fontWeight: 500, color: C.text, letterSpacing: "0.02em", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline" },
    exTarget: { color: C.textDim, fontWeight: 400, fontSize: 11 },
    // Column headers for tables
    colTag: { display: "grid", gridTemplateColumns: "20px 1fr 1fr 44px 46px", gap: 5, marginBottom: 3 }, // V12: +RIR col
    colTagSpan: { fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "center", fontWeight: 500 },
    // Set/row in table: hairline above
    setLine: { display: "grid", gridTemplateColumns: "20px 1fr 1fr 44px 46px", gap: 5, marginBottom: 0, alignItems: "center", paddingTop: 4, borderTop: `1px solid ${C.line}` }, // V12: +RIR col
    setN: { fontSize: 11, color: C.textFaint, textAlign: "center" },
    // Input cell: minimal border, no fill
    cell: { background: C.inputBg, border: `1px solid ${C.line}`, borderRadius: 0, padding: "9px 3px", textAlign: "center", fontSize: 16, fontWeight: 500, color: C.text, fontFamily: mono, width: "100%", boxSizing: "border-box", outline: "none", transition: "background 140ms ease, border-color 140ms ease, color 140ms ease", ...TNUM },
    cellSet: { borderColor: C.setDoneBorder, color: C.setDoneText },
    x: { border: `1px solid ${C.line}`, background: C.inputBg, borderRadius: 0, height: 44, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.textFaint, cursor: "pointer", transition: "background 140ms ease, border-color 140ms ease, color 140ms ease" },
    xOn: { borderColor: C.setDoneBorder, color: C.setDoneText, fontWeight: 600 },
    // Grid for cardio/macro inputs: ruled rows
    cardio: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, background: C.bg, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` },
    cardioCell: { background: C.cardBg, padding: "9px 4px", textAlign: "center", borderRight: `1px solid ${C.line}` },
    cardioInput: { background: C.cardBg, border: "none", borderRight: `1px solid ${C.line}`, padding: "8px 4px", textAlign: "center", fontSize: 16, fontWeight: 500, color: C.text, fontFamily: mono, width: "100%", boxSizing: "border-box", outline: "none" },
    cardioL: { fontSize: 10, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 2, fontWeight: 500 },
    cardioNote: { fontSize: 11, color: C.textDim, marginTop: 8, lineHeight: 1.5 },
    macroLine: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, background: C.bg, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, marginBottom: 8 },
    macroCell: { background: C.cardBg, padding: "8px 3px", textAlign: "center", borderRight: `1px solid ${C.line}` },
    macroInput: { background: C.cardBg, border: "none", borderRight: `1px solid ${C.line}`, padding: "6px 2px", textAlign: "center", fontSize: 16, fontWeight: 500, color: C.text, fontFamily: mono, width: "100%", boxSizing: "border-box", outline: "none" },
    macroL: { fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 2, fontWeight: 500 },
    // Progress row with telemetry
    progRow: { display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textDim, letterSpacing: "0.05em", marginBottom: 6, paddingTop: 4, borderTop: `1px solid ${C.line}` },
    bar: { height: 1, background: C.line, marginBottom: 8 },
    // Food button: hairline border, monospace label
    foodBtn: { width: "100%", background: C.inputBg, border: `1px solid ${C.line}`, borderRadius: 0, padding: 11, color: C.text, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 6, fontFamily: annot, cursor: "pointer", fontWeight: 500 },
    // Water readout: serif display number
    waterRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
    waterV: { fontSize: 36, fontWeight: 500, fontFamily: serif, color: C.text, ...TNUM },
    waterUnit: { fontSize: 11.5, color: C.textDim, fontWeight: 400 },
    waterBtns: { display: "flex", gap: 6 },
    waterB: { background: C.inputBg, border: `1px solid ${C.line}`, borderRadius: 0, padding: "12px 15px", minHeight: 44, color: C.text, fontSize: 11.5, fontFamily: annot, cursor: "pointer", fontWeight: 500 },
    // Body measurements grid
    bodyLine: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0, background: C.bg, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` },
    bodyCell: { background: C.cardBg, padding: "8px 3px", textAlign: "center", borderRight: `1px solid ${C.line}` },
    bodyInput: { background: C.cardBg, border: "none", borderRight: `1px solid ${C.line}`, padding: "6px 2px", textAlign: "center", fontSize: 16, fontWeight: 500, color: C.text, fontFamily: mono, width: "100%", boxSizing: "border-box", outline: "none" },
    bodyL: { fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 2, fontWeight: 500 },
    // Supplements: hairline buttons
    supps: { display: "flex", flexWrap: "wrap", gap: 6 },
    supp: { padding: "8px 12px", border: `1px solid ${C.line}`, borderRadius: 0, fontSize: 11, color: C.textDim, letterSpacing: "0.05em", textTransform: "uppercase", cursor: "pointer", background: C.inputBg, fontWeight: 500, transition: "background 140ms ease, border-color 140ms ease, color 140ms ease" },
    suppOn: { borderColor: C.text, color: C.text },
    // Bottom navigation: ruled tab bar with underline active state
    nav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: "var(--ovt-content-width)", display: "flex", flexDirection: "column", borderTop: `1px solid ${C.line}`, background: C.panel, zIndex: 200 },
    navInner: { display: "flex", width: "100%" },
    navSafeArea: { height: "env(safe-area-inset-bottom, 0px)", background: C.panel },
    // Navigation item: uppercase mono label, softened active state. Active reads
    // via a subtle fill + top accent rather than a table-like underline rule, so
    // the tap target feels lighter while the current tab is unmistakable.
    navItem: { flex: 1, padding: "12px 2px 10px", textAlign: "center", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textFaint, fontFamily: annot, fontWeight: 500, background: "none", border: "none", borderTop: "1px solid transparent", outline: "none", cursor: "pointer", minHeight: 48, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", WebkitTapHighlightColor: "transparent", transition: "color 140ms ease, background 140ms ease" },
    navItemActive: { color: C.text, borderTop: `1px solid ${C.lineBright}`, background: C.bg, fontWeight: 600 },
    // ── Quick-action FAB + sheet (V5.0 nav restructure) ──
    // The FAB sits centered in the tab row, raised above the hairline so it
    // reads as an action rather than a fifth destination. It echoes the serif
    // display language (leadFigure) used for hero numbers elsewhere, rather
    // than introducing an icon into an otherwise icon-free, text-only nav.
    navFabSlot: { width: 64, display: "flex", justifyContent: "center", flexShrink: 0 },
    navFab: { width: 50, height: 50, marginBottom: 14, background: C.text, color: C.bg, border: "none", borderRadius: C.cardRadius, fontFamily: serif, fontSize: 26, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 10px 20px -8px rgba(0,0,0,0.35)", WebkitTapHighlightColor: "transparent" },
    sheetScrim: { position: "fixed", inset: 0, background: "rgba(20,19,17,0.4)", zIndex: 250, opacity: 0, pointerEvents: "none", transition: "opacity 180ms ease" },
    sheetScrimOpen: { opacity: 1, pointerEvents: "auto" },
    sheet: { position: "fixed", left: "50%", transform: "translateX(-50%) translateY(100%)", bottom: 0, width: "100%", maxWidth: "var(--ovt-content-width)", background: C.panel, borderTop: `1px solid ${C.line}`, borderRadius: `${C.cardRadius}px ${C.cardRadius}px 0 0`, zIndex: 251, padding: "8px 16px calc(22px + env(safe-area-inset-bottom, 0px))", transition: "transform 220ms ease" },
    sheetOpen: { transform: "translateX(-50%) translateY(0)" },
    sheetHandle: { width: 32, height: 3, background: C.lineBright, borderRadius: 2, margin: "6px auto 12px" },
    sheetHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 4 },
    sheetTitle: { fontFamily: annot, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.textFaint },
    sheetClose: { background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim, fontFamily: annot, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", padding: "6px 9px", cursor: "pointer" },
    sheetAction: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", borderTop: `1px solid ${C.line}`, background: "none", border: "none", borderLeft: "none", borderRight: "none", borderBottom: "none", cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent" },
    sheetActionLabel: { fontSize: 14, color: C.text, fontWeight: 500 },
    sheetActionSub: { fontSize: 11, color: C.textDim, marginTop: 2 },
    sheetActionArrow: { fontFamily: serif, fontSize: 15, color: C.textFaint, flexShrink: 0, marginLeft: 10 },
    // ── Header profile entry + full-screen overlay back bar ──
    profileBtn: { background: "none", border: `1px solid ${C.lineBright}`, color: C.textDim, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", fontFamily: annot, padding: "4px 9px" },
    overlayBackRow: { padding: "12px 16px", borderBottom: `1px solid ${C.line}`, background: C.panel, display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, zIndex: 100 },
    overlayBackBtn: { background: "none", border: "none", color: C.textDim, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer", fontFamily: annot, padding: 0 },
    overlayBackTitle: { fontFamily: annot, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim },
    // Notes/textarea
    notesInput: { background: C.inputBg, border: `1px solid ${C.line}`, borderRadius: 0, padding: "9px 10px", fontSize: 16, color: C.text, fontFamily: mono, width: "100%", boxSizing: "border-box", outline: "none", marginTop: 8 },
    // Backup bar
    backupBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${C.line}`, background: C.panel },
    backupTxt: { fontSize: 11, color: C.textDim, letterSpacing: "0.08em", textTransform: "uppercase" },
    // Small button
    smallBtn: { background: C.inputBg, border: `1px solid ${C.line}`, borderRadius: 0, padding: "10px 13px", color: C.text, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: annot, cursor: "pointer", fontWeight: 500, minHeight: 44 },
    // Authentication forms
    authWrap: { minHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "32px 24px", maxWidth: 420, margin: "0 auto" },
    // Display serif headline for auth
    authTitle: { fontSize: 32, fontWeight: 500, fontFamily: serif, color: C.text, letterSpacing: "-0.02em", marginBottom: 8 },
    authSub: { fontSize: 11.5, color: C.textDim, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 32, fontWeight: 500 },
    authLabel: { fontSize: 10.5, color: C.textDim, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 6, marginTop: 18, fontWeight: 500 },
    authInput: { background: C.inputBg, border: `1px solid ${C.line}`, borderRadius: 0, padding: "11px 12px", fontSize: 16, color: C.text, fontFamily: mono, width: "100%", boxSizing: "border-box", outline: "none" },
    authBtn: { width: "100%", background: C.inputBg, border: `1px solid ${C.line}`, borderRadius: 0, padding: "14px", color: C.text, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: annot, cursor: "pointer", marginTop: 32, fontWeight: 600 },
    authToggle: { background: "none", border: "none", color: C.textDim, fontSize: 11, fontFamily: mono, cursor: "pointer", marginTop: 20, textAlign: "center", width: "100%", letterSpacing: "0.05em" },
    authError: { background: C.bg, border: `1px solid ${C.line}`, color: C.red, fontSize: 11, padding: "11px 12px", borderRadius: 0, marginTop: 16, letterSpacing: "0.03em", lineHeight: 1.5 },
    authNote: { fontSize: 11, color: C.textFaint, lineHeight: 1.6, marginTop: 20, letterSpacing: "0.02em" },
  };
}

// ── Design tokens ─────────────────────────────────────────────────────────────
// Shared spacing / radius / type-scale primitives so new UI stays visually
// consistent. Existing components keep their inline values; the new UI
// primitives and the Today command-center surfaces read from here. Purely
// additive — no existing style depends on this.
export const TOKENS = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { none: 0, subtle: 2, card: 4 },
  typeScale: { micro: 9.5, caption: 11, body: 13, bodyLarge: 14, title: 20, hero: 28 },
};

// Map a semantic status to a theme ink. The whitepaper themes are single-ink,
// so good/neutral resolve to primary ink and only warning spends the one
// reserved signal colour — matching the existing readiness language.
export function statusColor(C, status) {
  switch (status) {
    case "good":    return C.green;
    case "caution": return C.textDim;
    case "warning": return C.red || C.signal;
    case "neutral":
    default:        return C.text;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────
const ThemeContext = createContext(null);

export function ThemeProvider({ children, themeId = "whitepaperLight" }) {
  const C = THEMES[themeId] || THEMES.whitepaperLight;
  const S = useMemo(() => buildStyles(C), [themeId]);
  return (
    <ThemeContext.Provider value={{ C, S, themeId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
