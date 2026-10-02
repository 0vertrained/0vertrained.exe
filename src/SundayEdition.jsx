// src/SundayEdition.jsx
// ─────────────────────────────────────────────────────────────────────────────
// V17.2 · The Sunday Edition — the weekly broadsheet overlay.
//
// Renders the pure model from sundayEdition.js in strict anatomy order:
// masthead → the week in recovery → load ledger → volume digest (exceptions
// only) → fuel week → divergence diary → THE ONE CHANGE → footer. Whitepaper
// vocabulary throughout; MethodLine under every figure; the ONE CHANGE is the
// single full-ink plate on the page. Honest degradation: thin sections say so
// in one line and step aside.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from "react";
import { useTheme } from "./theme";
import { FigureSection, RuledRow, Sparkline, MethodLine, StatusStamp } from "./whitepaper";
import { buildSundayEdition } from "./sundayEdition";

export function SundayEdition({ data, ouraData, whoopData, settings, onClose, now = null }) {
  const { C, S } = useTheme();
  const model = useMemo(
    () => buildSundayEdition({ data, ouraData, whoopData, settings, now: now || new Date() }),
    [data, ouraData, whoopData, settings, now]
  );
  const { edition, recoveryWeek, loadLedger, volumeDigest, fuelWeek, divergenceDiary, oneChange, completeness } = model;
  const annot = { fontFamily: S.fontAnnot, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textFaint };
  const rolling = recoveryWeek.scorePoints.length >= 4
    ? recoveryWeek.scorePoints.map((p, i, arr) => {
        const win = arr.slice(Math.max(0, i - 2), i + 1);
        return { date: p.date, value: win.reduce((a, x) => a + x.value, 0) / win.length };
      })
    : null;

  return (
    <div role="dialog" aria-modal="true" aria-label="The Sunday Edition" style={{ position: "fixed", inset: 0, zIndex: 400, background: C.bg, overflowY: "auto" }}>
      <div style={{ maxWidth: "var(--ovt-content-width)", margin: "0 auto", padding: "0 0 40px" }}>

        {/* Masthead */}
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.text}`, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div>
            <div style={{ fontFamily: S.fontSerif, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", color: C.text }}>The Sunday Edition</div>
            <div style={{ ...annot, marginTop: 2 }}>№ {edition.number} · {edition.label}</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: C.fontFamily, cursor: "pointer", padding: "8px 0" }}>Close ×</button>
        </div>

        {completeness.caveat && (
          <div style={{ margin: "12px 16px 0", fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 13, color: C.textDim, lineHeight: 1.5 }}>
            {completeness.caveat}
          </div>
        )}

        {/* 1 · The week in recovery */}
        <FigureSection title="The week in recovery" right={<StatusStamp>{completeness.wearableMornings}/7 mornings</StatusStamp>}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 4, marginBottom: 10 }}>
            {recoveryWeek.timeline.map((t) => (
              <div key={t.date} style={{ textAlign: "center", flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: C.monoFamily, fontSize: 9.5, letterSpacing: "0.08em", color: C.textFaint }}>{t.dayName}</div>
                <div style={{ fontFamily: C.monoFamily, fontSize: 12, color: t.score === null ? C.textFaint : C.text, marginTop: 2 }}>{t.score ?? "·"}</div>
                <div style={{ fontFamily: S.fontAnnot, fontSize: 8.5, letterSpacing: "0.04em", textTransform: "uppercase", color: t.stateKey === "deload" ? C.text : C.textFaint, fontWeight: t.stateKey === "deload" ? 700 : 400, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.stateName === "—" ? "" : t.stateName}</div>
              </div>
            ))}
          </div>
          {recoveryWeek.scorePoints.length >= 2 && (
            <Sparkline points={recoveryWeek.scorePoints} overlayPoints={rolling} width={260} height={40} label="the week's line" />
          )}
          <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 13.5, color: C.textDim, lineHeight: 1.45, marginTop: 10 }}>
            {recoveryWeek.summary}
          </div>
          {recoveryWeek.sleepDebt && (
            <RuledRow label="Sleep this week" value={`${recoveryWeek.sleepDebt.debtHours}h debt · ${recoveryWeek.sleepDebt.band}`} />
          )}
          <MethodLine testId="method-edition-recovery" method="each morning scored and classified exactly as it was that day — nothing re-graded in hindsight" />
        </FigureSection>

        {/* 2 · Load ledger */}
        <FigureSection title="Load ledger" right={loadLedger.zoneLabel ? <StatusStamp>{loadLedger.zoneLabel}</StatusStamp> : null}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 54, marginBottom: 8 }}>
            {loadLedger.days.map((d) => {
              const max = Math.max(...loadLedger.days.map((x) => x.load), 1);
              return (
                <div key={d.date} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ height: 40, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                    <div style={{ width: "60%", height: `${Math.max(2, (d.load / max) * 40)}px`, background: d.load > 0 ? C.text : C.line }} />
                  </div>
                  <div style={{ fontFamily: C.monoFamily, fontSize: 9, color: C.textFaint, marginTop: 3 }}>{d.dayName}</div>
                </div>
              );
            })}
          </div>
          <RuledRow label="This week" value={`${loadLedger.weekTotal} au${loadLedger.deltaPct !== null ? ` · ${loadLedger.deltaPct > 0 ? "+" : ""}${loadLedger.deltaPct}% vs last` : ""}`} />
          <MethodLine testId="method-edition-load" method="load counted in effort-minutes across lifting and cardio — the same currency as the Training Load figure" />
        </FigureSection>

        {/* 3 · Volume digest — exceptions only */}
        <FigureSection title="Volume digest" right={volumeDigest.ready ? <StatusStamp>{volumeDigest.line}</StatusStamp> : null}>
          {!volumeDigest.ready ? (
            <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.6 }}>{volumeDigest.line}</div>
          ) : volumeDigest.exceptions.length === 0 ? (
            <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 13.5, color: C.textDim, lineHeight: 1.5 }}>{volumeDigest.line} Nothing to fix here.</div>
          ) : (
            volumeDigest.exceptions.map((e) => (
              <div key={e.key} style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6, padding: "5px 0", borderBottom: `1px solid ${C.line}` }}>{e.line}</div>
            ))
          )}
          <MethodLine testId="method-edition-volume" method="exceptions only — muscles inside their productive range don't need your attention this week" />
        </FigureSection>

        {/* 4 · Fuel week */}
        <FigureSection title="Fuel week" right={<StatusStamp>{fuelWeek.daysLogged}/7 logged</StatusStamp>}>
          <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 13.5, color: C.textDim, lineHeight: 1.5, marginBottom: fuelWeek.daysLogged ? 8 : 0 }}>{fuelWeek.line}</div>
          {fuelWeek.avgCalories !== null && <RuledRow label="Calories · avg" value={`${fuelWeek.avgCalories.toLocaleString()}${fuelWeek.calorieTarget ? ` / ${fuelWeek.calorieTarget.toLocaleString()} target` : ""}`} />}
          {fuelWeek.tdee && <RuledRow label="Measured burn" value={`${fuelWeek.tdee.value.toLocaleString()} kcal/day`} />}
          {fuelWeek.tdee && <MethodLine testId="method-edition-fuel" method={`from your ${fuelWeek.tdee.spanDays}-day intake-vs-weight ledger — not a formula guess`} />}
        </FigureSection>

        {/* 5 · Divergence diary */}
        {divergenceDiary.length > 0 && (
          <FigureSection title="Divergence diary" right={<StatusStamp>feel vs metrics</StatusStamp>}>
            {divergenceDiary.map((d) => (
              <div key={d.date} style={{ padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ fontFamily: C.monoFamily, fontSize: 10, letterSpacing: "0.1em", color: C.textFaint }}>{d.dayName.toUpperCase()}</div>
                <div style={{ fontSize: 12.5, color: C.textDim, lineHeight: 1.55, marginTop: 2 }}>{d.note}</div>
                {d.resolution && <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 12.5, color: C.text, lineHeight: 1.5, marginTop: 3 }}>{d.resolution}</div>}
              </div>
            ))}
          </FigureSection>
        )}

        {/* 6 · THE ONE CHANGE — the closing full-ink plate */}
        <div data-testid="one-change" style={{ margin: "18px 16px 0", background: C.text, color: C.panel, padding: "16px 16px 14px" }}>
          <div style={{ fontFamily: S.fontAnnot, fontSize: 10.5, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.75, marginBottom: 8 }}>The one change</div>
          <div style={{ fontFamily: S.fontSerif, fontSize: 18, fontWeight: 500, lineHeight: 1.3, letterSpacing: "-0.01em" }}>{oneChange.text}</div>
          <div style={{ fontFamily: S.fontAnnot, fontSize: 10.5, letterSpacing: "0.04em", opacity: 0.75, lineHeight: 1.5, marginTop: 8 }}>
            Why: {oneChange.reason} · {oneChange.method}
          </div>
        </div>

        {/* Footer */}
        <div style={{ ...annot, textAlign: "center", marginTop: 22 }}>Next edition Sunday.</div>
      </div>
    </div>
  );
}

export default SundayEdition;
