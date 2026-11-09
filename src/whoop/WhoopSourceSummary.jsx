// src/whoop/WhoopSourceSummary.jsx
// Wearable source summary bar
//
// A small, subtle bar that shows which signal sources are currently
// contributing context — Oura, Whoop, Manual — and their connection state. It
// shows PRESENCE only: no raw scores, no biometrics, and it never implies any
// source feeds the recovery algorithm. The recovery score remains Oura + manual.

import { useTheme } from "../theme";

export function WhoopSourceSummary({ ouraConnected = false, whoopConnected = false, manual = false }) {
  const { C } = useTheme();
  const annot = C.monoFamily || C.fontFamily;

  const sources = [
    { label: "Oura", on: !!ouraConnected },
    { label: "Whoop", on: !!whoopConnected },
    { label: "Manual", on: !!manual },
  ];

  const wrap = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    padding: "8px 16px",
    borderTop: `1px solid ${C.line}`,
    borderBottom: `1px solid ${C.line}`,
    background: C.bg,
  };
  const lead = { fontFamily: annot, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.textFaint };
  const chip = (on) => ({
    fontFamily: annot,
    fontSize: 10,
    letterSpacing: "0.06em",
    color: on ? C.text : C.textFaint,
    opacity: on ? 1 : 0.6,
  });
  const dot = (on) => ({
    display: "inline-block",
    width: 5,
    height: 5,
    marginRight: 4,
    borderRadius: "50%",
    background: on ? C.text : "transparent",
    border: `1px solid ${on ? C.text : C.textFaint}`,
    verticalAlign: "middle",
  });

  return (
    <div style={wrap}>
      <span style={lead}>Wearables</span>
      {sources.map((s) => (
        <span key={s.label} style={chip(s.on)} title={s.on ? "connected" : "not connected"}>
          <span style={dot(s.on)} />
          {s.label}
          <span style={{ marginLeft: 4, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.04em" }}>
            {s.on ? "· connected" : "· off"}
          </span>
        </span>
      ))}
    </div>
  );
}

export default WhoopSourceSummary;
