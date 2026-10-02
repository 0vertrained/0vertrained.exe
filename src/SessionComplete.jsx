// src/SessionComplete.jsx
// ─────────────────────────────────────────────────────────────────────────────
// V17.5 · The Box Score — the post-session story.
//
// The seconds after the last set are the peak-emotion moment of the loop; the
// old screen spent them on one number and a random flavor line. This one
// tells the session's story from data the app already computes (boxScore.js):
// headline → tonnage vs the last same-day session → PRs → strength arrows →
// sets banked toward the weekly landmarks → skips named honestly → the
// finisher handoff (log the day's prescribed cardio in one tap) → method.
//
// Interaction rules: a rich screen deserves a deliberate exit — tapping the
// backdrop OR the Close button dismisses; tapping the card never does (no
// accidental dismissal mid-read). Honest degradation: no prior same-day
// session → no fake deltas, and the headline says the baseline is set.
// ─────────────────────────────────────────────────────────────────────────────
import { useTheme } from "./theme";
import { MethodLine } from "./whitepaper";

export function SessionComplete({ boxScore, finisher = null, onDismiss }) {
  const { S, C } = useTheme();
  const mono = C.monoFamily || C.fontFamily;
  const b = boxScore || {};
  const row = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "7px 0", borderBottom: `1px solid ${C.line}` };
  const label = { fontFamily: S.fontAnnot, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint };
  const value = { fontFamily: mono, fontSize: 13, color: C.text, textAlign: "right" };

  return (
    <div
      data-testid="box-score-backdrop"
      onClick={onDismiss}
      style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(20,18,14,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}
      role="dialog" aria-modal="true" aria-label="Session box score"
    >
      <div data-testid="box-score" onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: "min(420px, calc(var(--ovt-content-width) - 24px))", maxHeight: "86dvh", overflowY: "auto", background: C.bg, border: `1px solid ${C.text}`, padding: "18px 18px 14px" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
          <span style={{ ...label }}>The box score</span>
          <button type="button" onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim, padding: "4px 0" }}>Close ×</button>
        </div>

        <div style={{ fontFamily: S.fontSerif, fontSize: 24, fontWeight: 500, lineHeight: 1.16, letterSpacing: "-0.02em", color: C.text, marginBottom: 12 }}>
          {b.headline || "Session banked."}
        </div>

        <div style={row}>
          <span style={label}>Tonnage</span>
          <span style={value}>
            {(b.tonnage || 0).toLocaleString()} lb
            {b.tonnageCompare && (
              <span style={{ color: C.textDim }}> · {b.tonnageCompare.deltaPct > 0 ? "+" : ""}{b.tonnageCompare.deltaPct}% vs last</span>
            )}
          </span>
        </div>

        {(b.prs || []).map((pr) => (
          <div key={pr.name} style={row}>
            <span style={{ ...label, color: C.text }}>PR · {pr.name}</span>
            <span style={value}>e1RM {pr.e1rm} <span style={{ color: C.textFaint }}>(was {pr.priorBest})</span></span>
          </div>
        ))}

        {(b.arrows || []).filter((a) => !(b.prs || []).some((p) => p.name === a.name)).map((a) => (
          <div key={a.name} style={row}>
            <span style={label}>{a.name}</span>
            <span style={value}>e1RM {a.e1rm} {a.dir}</span>
          </div>
        ))}

        {(b.banked || []).map((m) => (
          <div key={m.key} style={row}>
            <span style={label}>{m.label} · banked</span>
            <span style={value}>{m.today} sets{m.weekNote ? <span style={{ color: C.textFaint }}> · {m.weekNote}</span> : null}</span>
          </div>
        ))}

        {(b.skips || []).map((sk) => (
          <div key={sk.name} style={row}>
            <span style={label}>Skipped · {sk.name}</span>
            <span style={{ ...value, color: C.textDim }}>{sk.reason}</span>
          </div>
        ))}

        {finisher && (
          <button
            type="button"
            data-testid="finisher-log"
            onClick={(e) => { e.stopPropagation(); finisher.onLog(); }}
            style={{ width: "100%", marginTop: 14, padding: "12px", cursor: "pointer", borderRadius: 0, border: `1px solid ${C.text}`, background: C.text, color: C.panel, fontFamily: S.fontAnnot, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}
          >
            Log the finisher — {finisher.label}
          </button>
        )}
        {finisher && (
          <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", fontSize: 12, color: C.textDim, marginTop: 6, lineHeight: 1.45 }}>
            Logs the prescribed distance now — add your time on the day card whenever.
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <MethodLine testId="method-box-score" method={b.method || "e1RM from straight sets only"} />
        </div>
      </div>
    </div>
  );
}

export default SessionComplete;
