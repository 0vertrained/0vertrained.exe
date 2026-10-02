import { useTheme } from "../theme";

// ─────────────────────────────────────────────────────────────────────────────
//  LineFigure — one charting primitive for the whole app (Improvements §4).
//  Consolidates the hand-rolled SVG line charts behind a single component with
//  consistent conventions: hairline reference lines with direct labels, end-of-
//  line value labels, optional markers, and dual-series overlays. The aesthetic
//  is built for annotated Tufte-style figures — this makes that consistent.
//
//  normalize:
//    "shared" — all series + reference values share one Y domain (use when the
//               lines are comparable, e.g. a value against its target).
//    "each"   — each series is scaled to its own min/max (use for overlays of
//               different units, e.g. recovery vs training load).
// ─────────────────────────────────────────────────────────────────────────────

function InsufficientData({ C, height, have = 0, need = 2 }) {
  const mono = C.monoFamily || C.fontFamily;
  return (
    <div style={{ width: "100%", height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <span style={{ fontFamily: mono, fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        {have} / {need} logged · keep going to chart this
      </span>
      <div style={{ display: "flex", gap: 4 }} aria-hidden="true">
        {Array.from({ length: need }).map((_, i) => (
          <div key={i} style={{ width: 16, height: 3, background: i < have ? C.text : C.line }} />
        ))}
      </div>
    </div>
  );
}

export function LineFigure({
  series = [],
  referenceLines = [],
  vmarkers = [],
  normalize = "shared",
  width = 320,
  height = 84,
  pad = 6,
  xLabels = null,
  legend = null,
  ariaLabel,
}) {
  const { C } = useTheme();
  const mono = C.monoFamily || C.fontFamily;
  const n = series.reduce((m, s) => Math.max(m, (s.values || []).length), 0);
  if (n < 2) return <InsufficientData C={C} height={height} have={n} need={2} />;

  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const xAt = (i) => pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yIn = (v, lo, hi) => pad + innerH - ((v - lo) / ((hi - lo) || 1)) * innerH;

  let gMin = Infinity, gMax = -Infinity;
  if (normalize === "shared") {
    const all = series.flatMap((s) => s.values).concat(referenceLines.map((r) => r.value));
    gMin = Math.min(...all); gMax = Math.max(...all);
  }

  const scaled = series.map((s) => {
    const lo = normalize === "each" ? Math.min(...s.values) : gMin;
    const hi = normalize === "each" ? Math.max(...s.values) : gMax;
    const pts = s.values.map((v, i) => ({ x: xAt(i), y: yIn(v, lo, hi) }));
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    return { ...s, pts, d };
  });

  return (
    <div style={{ width: "100%" }}>
      {legend && (
        <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
          {legend.map((l, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.textDim, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              <span aria-hidden="true" style={{ width: 14, height: 0, borderTop: `${l.dash ? "1.5px dashed" : "1.5px solid"} ${l.stroke || C.text}` }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} style={{ display: "block" }}>
        {vmarkers.map((m, i) => (
          <line key={`v${i}`} x1={xAt(m.index).toFixed(1)} y1={pad} x2={xAt(m.index).toFixed(1)} y2={height - pad} stroke={m.stroke || C.line} strokeWidth="1" strokeDasharray="2 3" />
        ))}
        {normalize === "shared" && referenceLines.map((r, i) => {
          const y = yIn(r.value, gMin, gMax);
          return (
            <g key={`r${i}`}>
              <line x1={pad} y1={y.toFixed(1)} x2={width - pad} y2={y.toFixed(1)} stroke={r.stroke || C.line} strokeWidth="1" strokeDasharray="3 3" />
              {r.label && <text x={width - pad} y={(y - 4).toFixed(1)} textAnchor="end" fill={C.textFaint} fontSize="9" fontFamily={mono} style={{ letterSpacing: "0.06em" }}>{r.label}</text>}
            </g>
          );
        })}
        {scaled.map((s, si) => {
          const last = s.pts[s.pts.length - 1];
          return (
            <g key={`s${si}`}>
              <path d={s.d} fill="none" stroke={s.stroke || C.text} strokeWidth={s.dash ? 1.25 : 1.5} strokeDasharray={s.dash ? "3 3" : undefined} strokeLinecap="round" strokeLinejoin="round" />
              {s.marker !== false && <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r="2.5" fill={s.stroke || C.text} />}
              {s.endLabel && <text x={(last.x - 4).toFixed(1)} y={(last.y - 6).toFixed(1)} textAnchor="end" fill={s.stroke || C.text} fontSize="9.5" fontFamily={mono}>{s.endLabel}</text>}
            </g>
          );
        })}
      </svg>
      {xLabels && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <span>{xLabels.left}</span>
          {xLabels.mid && <span>{xLabels.mid}</span>}
          <span>{xLabels.right}</span>
        </div>
      )}
    </div>
  );
}
