// src/ui/primitives.jsx
// Reusable UI primitives for the command-center surfaces. These keep the
// existing whitepaper/ledger identity (hairline rules, mono labels, serif
// display) but give repeated card/header/metric patterns one grammar so new
// surfaces stop reinventing their own. Each component reads the active theme
// internally via useTheme(); pass a `style` override where a caller needs to
// tune spacing. No new styling dependency, inline-compatible.
import { useState } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./useMediaQuery";
import { useTheme, statusColor } from "../theme";

// SectionHeader — consistent title / stat / optional action row. Mirrors the
// existing S.blockHead rhythm so it drops into any ruled block.
export function SectionHeader({ title, stat, tone, action, style }) {
  const { C, S } = useTheme();
  const ink = tone ? statusColor(C, tone) : C.textFaint;
  return (
    <div style={{ ...S.blockHead, ...(style || {}) }}>
      <span style={S.blockTitle}>{title}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        {stat && <span style={{ ...S.blockStat, color: ink }}>{stat}</span>}
        {action}
      </span>
    </div>
  );
}

// HeroCard — primary verdict / action frame. A soft hairline and generous
// padding lift it above the surrounding ledger blocks without creating a hard
// page-break rule.
export function HeroCard({ eyebrow, title, stat, tone, children, style }) {
  const { C, S } = useTheme();
  const ink = tone ? statusColor(C, tone) : C.text;
  return (
    <section style={{ ...S.block, borderTop: `1px solid ${C.line}`, paddingTop: 16, paddingBottom: 15, ...(style || {}) }}>
      {(eyebrow || stat) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: title ? 8 : 2 }}>
          {eyebrow && <span style={S.blockTitle}>{eyebrow}</span>}
          {stat && <span style={{ ...S.blockStat, color: ink }}>{stat}</span>}
        </div>
      )}
      {title && (
        <div style={{ fontFamily: S.fontSerif, fontSize: 24, fontWeight: 500, lineHeight: 1.12, letterSpacing: "-0.02em", color: C.text, marginBottom: children ? 6 : 0 }}>
          {title}
        </div>
      )}
      {children}
    </section>
  );
}

// MetricStrip — 3–5 compact status metrics in a ruled grid. Each item:
// { key, label, value, hint, tone }. Values use tabular figures and truncate
// rather than reflow so the strip never jitters as numbers update.
export function MetricStrip({ items = [], style }) {
  const { C, S } = useTheme();
  const shown = items.slice(0, 5);
  if (!shown.length) return null;
  const cols = shown.length;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, background: C.bg, ...(style || {}) }}>
      {shown.map((it, i) => {
        const ink = it.tone ? statusColor(C, it.tone) : C.text;
        return (
          <div key={it.key || it.label || i} style={{ padding: "10px 8px", borderRight: i < cols - 1 ? `1px solid ${C.line}` : "none", minWidth: 0 }}>
            <div style={{ fontFamily: S.fontSerif, fontSize: 19, lineHeight: 1, fontWeight: 500, color: ink, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {it.value}
            </div>
            <div style={{ ...S.metricLedgerLabel, marginTop: 5 }}>{it.label}</div>
            {it.hint && (
              <div style={{ fontFamily: C.monoFamily, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {it.hint}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ActionCard — one recommended action: label + detail + optional button. Used
// for shortcuts (e.g. "no plan yet → generate") without inventing new card art.
export function ActionCard({ label, detail, actionLabel, onAction, tone, style }) {
  const { C, S } = useTheme();
  const ink = tone ? statusColor(C, tone) : C.text;
  return (
    <section style={{ ...S.block, ...(style || {}) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, letterSpacing: "0.01em" }}>{label}</div>
          {detail && <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.45, marginTop: 4 }}>{detail}</div>}
        </div>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} style={{ ...S.smallBtn, borderColor: ink, color: ink, whiteSpace: "nowrap", flexShrink: 0 }}>
            {actionLabel}
          </button>
        )}
      </div>
    </section>
  );
}

// LedgerCard — dense factual rows. rows: [{ label, value }]. The canonical
// ruled key/value list, wrapped with a header so callers stop hand-rolling it.
export function LedgerCard({ title, stat, tone, rows = [], children, style }) {
  const { S } = useTheme();
  return (
    <section style={{ ...S.block, ...(style || {}) }}>
      {(title || stat) && <SectionHeader title={title} stat={stat} tone={tone} />}
      {rows.map((r, i) => (
        <div key={r.label || i} style={S.ruledRow}>
          <span style={S.ruledLabel}>{r.label}</span>
          <span style={S.ruledValue}>{r.value}</span>
        </div>
      ))}
      {children}
    </section>
  );
}

// EmptyStateCard — helpful empty / loading placeholder. When `loading` is set
// it shows a quiet pulsing bar so a tab renders a stable shell instead of a
// blank block while data resolves. No faked values.
export function EmptyStateCard({ title, message, loading = false, style }) {
  const { C, S } = useTheme();
  return (
    <section style={{ ...S.block, ...(style || {}) }}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{title}</span>
        {loading && <span style={S.blockStat}>Syncing</span>}
      </div>
      {message && <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5 }}>{message}</div>}
      {loading && (
        <div style={{ display: "grid", gap: 8, marginTop: message ? 12 : 4 }}>
          <div style={{ height: 16, background: C.line, borderRadius: 2, animation: "pulse 1.2s infinite" }} />
          <div style={{ height: 12, background: C.line, borderRadius: 2, width: "78%", animation: "pulse 1.2s infinite 0.12s both" }} />
        </div>
      )}
    </section>
  );
}

// LoadingShell — a tab's stable loading state: a stack of card skeletons whose
// headers mirror the loaded section rhythm, so a tab never looks blank or snaps
// in from a single thin row. `plan` is an array of { key, title, message? } (see
// uiStability.getSkeletonPlan). Reuses the EmptyStateCard grammar for one shared
// loading identity across Today / Fuel / Progress / Recovery.
export function LoadingShell({ plan = [], style }) {
  // At the broadsheet tier every skeleton renders as a centered
  // reading column instead of a full-width single stack that snaps into a
  // spread on load — kills the layout shift uniformly for all tabs.
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY);
  const rows = Array.isArray(plan) ? plan : [];
  if (!rows.length) return null;
  return (
    <div style={{ ...(isBroadsheet ? { maxWidth: "var(--ovt-content-width)", margin: "0 auto", width: "100%" } : null), ...style }} aria-busy="true">
      <span className="sr-only">Loading…</span>
      {rows.map((row, i) => (
        <EmptyStateCard
          key={row.key || row.title || i}
          title={row.title}
          message={i === 0 ? row.message : undefined}
          loading
        />
      ))}
    </div>
  );
}

// RefreshingBar — quiet, non-blocking strip shown above cached content while a
// background revalidation is in flight. Holds known content on screen instead
// of blanking the tab; announced politely to assistive tech.
export function RefreshingBar({ label = "Refreshing in background…", style }) {
  const { C } = useTheme();
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 16px",
        borderBottom: `1px solid ${C.line}`,
        background: C.block,
        fontSize: 10,
        color: C.textFaint,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        ...(style || {}),
      }}
    >
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", background: C.textDim, animation: "pulse 1.2s infinite", flexShrink: 0 }} />
      <span>{label}</span>
    </div>
  );
}

// SourceBadge — compact source / confidence tag. Matches the transparency
// badges already used inside Today Coach so data provenance stays visible.
export function SourceBadge({ children, tone, style }) {
  const { C } = useTheme();
  const ink = tone ? statusColor(C, tone) : C.textDim;
  return (
    <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: ink, border: `1px solid ${C.lineBright}`, padding: "2px 6px", ...(style || {}) }}>
      {children}
    </span>
  );
}

// Ink-state vocabulary
// Monochrome status devices. The palette is single-ink by design, so state is
// carried by PRINT devices instead of color words: an inverted stamp for the
// one daily verdict, a double rule for limiters that modify that verdict, a
// dotted tag for provisional/derived data, hairlines for everything else.
// Red remains reserved for failures (errors), never coaching.

// Stamp — the day's call, inverted ink. One per screen, max.
export function Stamp({ children, tone, style }) {
  const { C, S } = useTheme();
  const isError = tone === "error";
  return (
    <span style={{ fontFamily: S.fontAnnot, background: isError ? C.red : C.text, color: C.bg, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", padding: "4px 8px", fontWeight: 500, whiteSpace: "nowrap", ...(style || {}) }}>
      {children}
    </span>
  );
}

// LimiterRule — a constraint that modifies the verdict above it (sleep debt,
// illness flag, low confidence). Typeset as a double rule, never red.
export function LimiterRule({ label, children, style }) {
  const { C, S } = useTheme();
  return (
    <div style={{ borderTop: `3px double ${C.text}`, paddingTop: 6, ...(style || {}) }}>
      <div style={{ fontFamily: S.fontAnnot, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text, fontWeight: 500 }}>{label}</div>
      {children && <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5, marginTop: 5 }}>{children}</div>}
    </div>
  );
}

// ProvisionalTag — marks estimated, derived, or low-confidence values inline.
export function ProvisionalTag({ children = "Estimated", style }) {
  const { C, S } = useTheme();
  return (
    <span style={{ fontFamily: S.fontAnnot, border: `1px dotted ${C.textFaint}`, color: C.textFaint, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", padding: "1px 6px", whiteSpace: "nowrap", ...(style || {}) }}>
      {children}
    </span>
  );
}

// NavRow — a quiet navigation row (label + status sub + arrow). Leaves the
// current view; mirrors the sheet-action grammar so rows read as one family.
export function NavRow({ label, sub, onClick, style }) {
  const { C, S } = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "15px 16px", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent", ...(style || {}) }}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: C.text, fontFamily: S.fontMain }}>{label}</span>
        {sub && <span style={{ display: "block", fontFamily: S.fontAnnot, fontSize: 11.5, color: C.textFaint, marginTop: 3, letterSpacing: "0.03em" }}>{sub}</span>}
      </span>
      <span style={{ fontFamily: S.fontSerif, fontSize: 15, color: C.textFaint, flexShrink: 0 }} aria-hidden="true">→</span>
    </button>
  );
}

// DisclosureBlock — a collapsed section row that expands in place. The summary
// row carries the same geometry as NavRow but with a chevron; children render
// below when open. Uncontrolled (defaultOpen) to keep call sites simple.
export function DisclosureBlock({ label, sub, defaultOpen = false, plain = false, children, style }) {
  const { C, S } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  // plain=true renders children directly with no summary row — used when a
  // context (e.g. logging a past day) needs everything visible, no folding.
  if (plain) return <section style={style}>{children}</section>;
  return (
    <section style={{ borderBottom: `1px solid ${C.line}`, ...(style || {}) }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "15px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent" }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: C.text, fontFamily: S.fontMain }}>{label}</span>
          {sub && <span style={{ display: "block", fontFamily: S.fontAnnot, fontSize: 11.5, color: C.textFaint, marginTop: 3, letterSpacing: "0.03em" }}>{sub}</span>}
        </span>
        <span style={{ fontFamily: S.fontSerif, fontSize: 15, color: C.textFaint, flexShrink: 0 }} aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}


// AdvisoryNote — the one way to say "worth knowing, not an
// error." Dim ink over a hairline rule; never red (red stays reserved for
// errors per the Whitepaper System). Both sentinel sites migrate here;
// future advisories (data quality, scoring basis) use this, not hand styles.
export function AdvisoryNote({ children, compact = false }) {
  const { C } = useTheme();
  return (
    <div style={{ fontSize: compact ? 9.5 : 10.5, color: C.textDim, letterSpacing: "0.04em", padding: compact ? "6px 0 0" : "8px 0 2px", borderTop: compact ? "none" : `1px solid ${C.line}`, marginTop: compact ? 6 : 8, lineHeight: 1.5, fontFamily: C.fontFamily }}>
      ⚠ {children}
    </div>
  );
}
