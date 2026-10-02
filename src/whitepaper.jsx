import { useTheme } from "./theme";

export function FigureSection({ n, title, right, children, style }) {
  const { S } = useTheme();
  return (
    <section style={{ ...S.block, ...(style || {}) }}>
      <FigureHeader n={n} title={title} right={right} />
      {children}
    </section>
  );
}

export function FigureHeader({ n, title, right }) {
  const { S } = useTheme();
  // V6: the figure number renders only when provided. Conditional sections
  // (whose visible sequence skips and forks day-to-day) pass no n — a number
  // that implies an order the page doesn't have is worse than none.
  return (
    <div style={S.blockHead}>
      <span style={S.blockTitle}>{n !== undefined && n !== null ? `Fig. ${n} · ${title}` : title}</span>
      {right && <span style={S.blockStat}>{right}</span>}
    </div>
  );
}

export function RuledRow({ label, value, children, emphasis = false }) {
  const { S, C } = useTheme();
  return (
    <div style={S.ruledRow}>
      <span style={{ ...S.ruledLabel, color: emphasis ? C.text : S.ruledLabel.color }}>{label}</span>
      {children || <span style={S.ruledValue}>{value}</span>}
    </div>
  );
}

// V17.1 · MethodLine — every number defends itself. The V16.9 sleep-debt row
// ("vs 7.6h baseline need (Whoop) · naps credited") generalized into a house
// primitive: one annot-vocabulary line of method directly under a figure, and
// an optional tap-to-expand detail in the Morning Edition details/summary
// pattern. Three disclosure registers coexist deliberately: MethodNote for
// static footnotes, the ⓘ toggle (ReadinessMethodToggle) for section
// headers, MethodLine for the number itself. Jargon is allowed ONLY inside
// the expandable.
export function MethodLine({ method, detail = null, testId = "method-line" }) {
  const { S, C } = useTheme();
  if (!method) return null;
  const line = (
    <span style={{ fontFamily: S.fontAnnot, fontSize: 10.5, letterSpacing: "0.04em", color: C.textFaint, lineHeight: 1.5 }}>
      {method}
    </span>
  );
  if (!detail) return <div data-testid={testId} style={{ marginTop: 4 }}>{line}</div>;
  return (
    <details data-testid={testId} style={{ marginTop: 4 }}>
      <summary style={{ cursor: "pointer", listStyle: "none" }}>
        {line}
        <span aria-hidden="true" style={{ fontFamily: S.fontAnnot, fontSize: 10.5, color: C.textFaint }}> +</span>
      </summary>
      <div style={{ marginTop: 6, fontSize: 12, color: C.textDim, lineHeight: 1.6, fontFamily: C.fontFamily }}>
        {detail}
      </div>
    </details>
  );
}

export function LeadMetric({ value, unit = "", caption, note }) {
  const { S, C } = useTheme();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14, alignItems: "end" }}>
      <div><span style={S.leadFigure}>{value}</span>{unit && <span style={S.leadUnit}>{unit}</span>}</div>
      <div style={{ paddingBottom: 8 }}>
        <div style={{ ...S.figureRule, background: C.textDim, marginBottom: 8 }} />
        {caption && <div style={{ fontFamily: S.fontSerif, fontStyle: "italic", color: C.textDim, fontSize: 14, lineHeight: 1.35 }}>{caption}</div>}
        {note && <div style={{ ...S.annotation, marginTop: 5 }}>{note}</div>}
      </div>
    </div>
  );
}

export function RuledScale({ value = 0, max = 100 }) {
  const { C } = useTheme();
  const pct = Math.max(0, Math.min(100, (Number(value) / Number(max || 100)) * 100));
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ height: 1, background: C.line, position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: -1, height: 3, width: `${pct}%`, background: C.text }} />
        <div style={{ position: "absolute", left: `${pct}%`, top: -5, width: 1, height: 11, background: C.text }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        <span>0</span><span>{max}</span>
      </div>
    </div>
  );
}

export function MetricFigure({ label, score, max, raw, baseline, source, note }) {
  const { S, C } = useTheme();
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "10px 0 0", marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <div style={S.ruledLabel}>{label}</div>
          <div style={{ ...S.annotation, marginTop: 4 }}>raw · {raw || "not available"}</div>
          {baseline && <div style={{ ...S.annotation, marginTop: 3 }}>baseline · {baseline}</div>}
          {source && <div style={{ ...S.annotation, marginTop: 3 }}>source · {source}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ ...S.metricLedgerValue, fontSize: 28 }}>{score ?? "—"}</span>
          <span style={S.leadUnit}>/{max}</span>
        </div>
      </div>
      <RuledScale value={score || 0} max={max} />
      {note && <div style={{ ...S.annotation, marginTop: 7 }}>{note}</div>}
    </div>
  );
}

export function MethodNote({ children }) {
  const { C } = useTheme();
  return <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}`, fontSize: 12, color: C.textDim, lineHeight: 1.65 }}>{children}</div>;
}

export function StatusStamp({ children }) {
  const { S, C } = useTheme();
  return <span style={{ ...S.blockStat, border: `1px solid ${C.line}`, padding: "2px 6px" }}>{children}</span>;
}

export function AlertCard({ severity, title, markers, message, recommendation }) {
  const { C } = useTheme();
  // V13 ink-state vocabulary: warnings are limiters, typeset as a double rule
  // in ink; cautions keep a dim hairline; red is reserved for genuine failures
  // (the new "error" severity — sync/token breakage), never coaching.
  const severityRules = {
    error: { rule: `2px solid ${C.red || "#c44"}`, text: C.red || "#c44", label: "ERROR" },
    warning: { rule: `3px double ${C.text}`, text: C.text, label: "WARNING" },
    caution: { rule: `1px solid ${C.textDim}`, text: C.textDim, label: "CAUTION" },
    positive: { rule: `1px solid ${C.text}`, text: C.text, label: "READY" },
  };
  const sc = severityRules[severity] || severityRules.caution;
  return (
    <div style={{ borderTop: sc.rule, borderBottom: `1px solid ${C.line}`, padding: "12px 0", marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: sc.text, fontFamily: C.fontFamily }}>{sc.label}</span>
        {markers && markers.length > 0 && (
          <span style={{ fontSize: 9.5, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {markers.map(m => m.replace(/_/g, " ")).join(" · ")}
          </span>
        )}
      </div>
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55, marginBottom: recommendation ? 8 : 0 }}>{message}</div>
      {recommendation && <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5, fontStyle: "italic" }}>{recommendation}</div>}
    </div>
  );
}

export function AlertHistory({ history }) {
  const { C, S } = useTheme();
  const entries = Object.entries(history || {}).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7);
  if (!entries.length) return null;
  const severityDot = (sev) => {
    const map = { warning: C.red || "#c44", caution: C.textDim, positive: C.green || "#4a8", clear: C.textFaint };
    return <span style={{ display: "inline-block", width: 6, height: 6, background: map[sev] || C.textFaint, marginRight: 8, flexShrink: 0 }} />;
  };
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ ...S.blockTitle, marginBottom: 8 }}>Recent signals</div>
      {entries.map(([date, entry]) => (
        <div key={date} style={{ ...S.ruledRow, padding: "5px 0" }}>
          <span style={{ ...S.ruledLabel, display: "flex", alignItems: "center" }}>
            {severityDot(entry.severity)}
            {date.slice(5)}
          </span>
          <span style={S.ruledValue}>
            {entry.markerCount > 0 ? `${entry.markerCount} marker${entry.markerCount > 1 ? "s" : ""}` : "clear"}
            {entry.positiveMarkerCount > 0 ? ` · ${entry.positiveMarkerCount} positive` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ points = [], width = 200, height = 40, color, label, overlayPoints = null }) {
  const { C } = useTheme();
  const stroke = color || C.text;
  if (!points || points.length < 2) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 10, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase" }}>insufficient data</span>
      </div>
    );
  }

  const pad = 4;
  const values = points.map(p => Number(p.value) || 0);
  // V16.8 · Optional second series (e.g. the rolling trend over the daily
  // points). Shares the min/max scale with the primary so the two lines are
  // honestly comparable; drawn faint and behind the daily line.
  const overlayValues = Array.isArray(overlayPoints) && overlayPoints.length >= 2
    ? overlayPoints.map(p => Number(p.value) || 0)
    : null;
  const all = overlayValues ? values.concat(overlayValues) : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const coords = values.map((v, i) => ({
    x: pad + (i / (values.length - 1)) * w,
    y: pad + h - ((v - min) / range) * h,
  }));

  const pathD = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const overlayD = overlayValues
    ? overlayValues.map((v, i) => {
        const x = pad + (i / (overlayValues.length - 1)) * w;
        const y = pad + h - ((v - min) / range) * h;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(" ")
    : null;
  const last = coords[coords.length - 1];
  const first = coords[0];
  const trend = last.y < first.y - 2 ? "improving ↑" : last.y > first.y + 2 ? "declining ↓" : "stable →";

  return (
    <div style={{ width, fontFamily: C.fontFamily }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
        {overlayD && <path d={overlayD} fill="none" stroke={C.textFaint} strokeWidth={1} strokeDasharray="1.5 2.5" strokeLinecap="round" strokeLinejoin="round" />}
        <path d={pathD} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r={2.5} fill={stroke} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9.5, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        <span>{points[0]?.date?.slice(5) || ""}</span>
        <span style={{ color: stroke }}>{label || trend}</span>
        <span>{points[points.length - 1]?.date?.slice(5) || ""}</span>
      </div>
    </div>
  );
}

// ─── Loading Skeleton Placeholders ───────────────────────────────────────────
// Stable layout placeholders during async data load. Uses theme tokens for consistency.
export function SkeletonBlock() {
  const { S, C } = useTheme();
  return (
    <section style={{ ...S.block }}>
      <div style={S.blockHead}>
        <span style={S.blockTitle}>▪ ▪ ▪ ▪ ▪</span>
        <span style={S.blockStat} />
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        <div style={{ height: 20, background: C.line, borderRadius: 2, animation: "pulse 1.2s infinite" }} />
        <div style={{ height: 14, background: C.line, borderRadius: 2, width: "85%", animation: "pulse 1.2s infinite 0.1s both" }} />
      </div>
    </section>
  );
}

export function SkeletonRow() {
  const { S, C } = useTheme();
  return (
    <div style={S.ruledRow}>
      <span style={{ ...S.ruledLabel, background: C.line, borderRadius: 2, height: 12, width: 80, display: "inline-block", animation: "pulse 1.2s infinite" }} />
      <span style={{ ...S.ruledValue, background: C.line, borderRadius: 2, height: 12, width: 120, display: "inline-block", animation: "pulse 1.2s infinite 0.1s both" }} />
    </div>
  );
}

export function SkeletonMetricFigure() {
  const { S, C } = useTheme();
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "10px 0 0", marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ ...S.ruledLabel, background: C.line, borderRadius: 2, height: 14, width: 100, animation: "pulse 1.2s infinite" }} />
          <div style={{ ...S.annotation, background: C.line, borderRadius: 2, height: 11, width: 150, marginTop: 6, animation: "pulse 1.2s infinite 0.1s both" }} />
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ width: 60, height: 28, background: C.line, borderRadius: 2, animation: "pulse 1.2s infinite" }} />
        </div>
      </div>
    </div>
  );
}
