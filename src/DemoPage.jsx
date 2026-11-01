import { useState, useEffect, useRef } from "react";
import { useTheme } from "./theme";
import { computeReadinessIndex } from "./decisionEngine";
// V13.2 · The readiness card, its band helpers, and the auto-cycling specimen
// moved to src/landing/ReadinessSpecimen.jsx so the logged-out landing's
// Fig. 1 and this page render one and the same component.
import { ReadinessCard, ReadinessSpecimen, bandFor, LABEL } from "./landing/ReadinessSpecimen";

// ─────────────────────────────────────────────────────────────────────────────
//  In-app demo / pitch page. Reached at #/demo (public — renders before the auth
//  gate) and from the More tab. Native to the Whitepaper System: it uses the
//  active theme and reuses the real readiness engine, so the interactive figure
//  produces the exact call the app would. The standalone /demo.html mirrors this
//  for sharing outside the app.
// ─────────────────────────────────────────────────────────────────────────────

// "Request early access" routes to the sign-in / create-account card on the
// landing page: changing the hash off #/demo closes this overlay via App's
// hashchange listener, landing on the auth screen's #signin section.
const SIGNUP_URL = "#signin";

const recPhrase = (r) => (r >= 70 ? "Recovery is strong" : r >= 55 ? "Recovery is moderate" : r >= 40 ? "Recovery is low" : "Recovery is suppressed");
const loadPhrase = (a) => (a <= 1.1 ? "load is in range" : a <= 1.3 ? "load is climbing but optimal" : a <= 1.5 ? "load is elevated — overreaching" : "load is high-risk");

// Generative flow field behind the hero — laminar/calm when recovered, turbulent when overreached.
function FlowField({ C, stressRef }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, particles = [], t = 0, raf = null, stress = stressRef ? stressRef.current : 0.06;
    const ink = C.text, bg = C.bg;
    const spawn = () => ({ x: Math.random() * W, y: Math.random() * H, life: 40 + Math.random() * 140 });
    const lerp = (a, b, p) => a + (b - a) * p;
    const angleAt = (x, y, tt, scale, turb) => {
      const nx = x * scale, ny = y * scale;
      let a = Math.sin(nx + tt) + Math.cos(ny - tt * 0.8) + Math.sin((nx + ny) * 0.5 + tt * 0.5);
      a += turb * Math.sin(nx * 2.3 - tt * 1.7) * Math.cos(ny * 1.9 + tt * 1.3);
      return a * Math.PI;
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const n = Math.round(Math.min(440, Math.max(150, (W * H) / 2500)));
      particles = []; for (let i = 0; i < n; i++) particles.push(spawn());
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    };
    const frame = () => {
      const tgt = stressRef ? stressRef.current : 0.06;
      stress = lerp(stress, tgt, 0.02);
      const s = stress;
      const speed = lerp(0.55, 1.95, s), scale = lerp(0.0015, 0.0066, s), turb = lerp(0.07, 1.3, s);
      const segA = lerp(0.055, 0.12, s), fadeA = lerp(0.040, 0.075, s);
      t += lerp(0.0015, 0.0052, s);
      ctx.globalAlpha = fadeA; ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = segA; ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i], ang = angleAt(p.x, p.y, t, scale, turb);
        const nx = p.x + Math.cos(ang) * speed * 1.4, ny = p.y + Math.sin(ang) * speed * 1.4;
        ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny);
        p.x = nx; p.y = ny; p.life -= 1;
        if (p.x < -6 || p.x > W + 6 || p.y < -6 || p.y > H + 6 || p.life <= 0) particles[i] = spawn();
      }
      ctx.stroke(); ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    resize();
    window.addEventListener("resize", resize);
    if (reduce) {
      const scale = 0.0022, turb = 0.12, speed = 0.9;
      ctx.globalAlpha = 0.10; ctx.strokeStyle = ink; ctx.lineWidth = 1;
      for (let k = 0; k < particles.length; k++) {
        const p = particles[k]; ctx.beginPath(); ctx.moveTo(p.x, p.y);
        for (let st = 0; st < 28; st++) { const ang = angleAt(p.x, p.y, 0, scale, turb); p.x += Math.cos(ang) * speed * 2; p.y += Math.sin(ang) * speed * 2; ctx.lineTo(p.x, p.y); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return () => window.removeEventListener("resize", resize);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [C, stressRef]);
  return <canvas ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none", display: "block" }} />;
}

function Eyebrow({ C, fig, name }) {
  const mono = C.monoFamily;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
      <span style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", color: C.text }}>{fig}</span>
      <span style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.16em", textTransform: "uppercase", color: C.textFaint }}>{name}</span>
    </div>
  );
}

function Plate({ C, label, caption, children }) {
  return (
    <div style={{ borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, padding: "24px 22px 22px", display: "flex", flexDirection: "column" }}>
      <div style={{ fontFamily: C.monoFamily, fontSize: 11.5, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textFaint, marginBottom: 18 }}>{label}</div>
      <div style={{ flex: 1, marginBottom: 16 }}>{children}</div>
      <div style={{ fontFamily: C.fontFamily, fontSize: 14, lineHeight: 1.5, color: C.textDim }}>{caption}</div>
    </div>
  );
}

function LogMock({ C }) {
  const mono = C.monoFamily, serif = C.serifFamily;
  const rows = [["1", "225", "5", "✓"], ["2", "225", "5", "✓"], ["3", "245", "5", "✓"], ["4", "245", "3", "○"]];
  const grid = { display: "grid", gridTemplateColumns: "22px 1fr 1fr 26px", gap: 6, alignItems: "center", textAlign: "center" };
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: serif, fontSize: 18, fontWeight: 500, color: C.text, marginBottom: 10 }}>
        <span>Back Squat</span><span style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.04em", color: C.textFaint, textTransform: "uppercase" }}>4 × 5 · RPE 8</span>
      </div>
      <div style={{ ...grid, padding: "4px 0", fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>
        <span>Set</span><span>Wt</span><span>Reps</span><span>✓</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ ...grid, padding: "6px 0", borderTop: `1px solid ${C.line}`, fontFamily: mono, fontSize: 14, color: C.text, fontVariantNumeric: "tabular-nums" }}>
          <span>{r[0]}</span><span>{r[1]}</span><span>{r[2]}</span>
          <span style={{ color: r[3] === "○" ? C.textFaint : C.text, fontWeight: r[3] === "○" ? 400 : 600 }}>{r[3]}</span>
        </div>
      ))}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: `1px solid ${C.textDim}`, marginTop: 8 }}>
        {[["3.2", "Miles"], ["7:42", "Pace"], ["Z2", "Effort"]].map((c, i) => (
          <div key={i} style={{ padding: "8px 4px", textAlign: "center", borderRight: i < 2 ? `1px solid ${C.line}` : "none" }}>
            <div style={{ fontFamily: mono, fontSize: 14, color: C.text, fontVariantNumeric: "tabular-nums" }}>{c[0]}</div>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint, marginTop: 3 }}>{c[1]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadMock({ C }) {
  const mono = C.monoFamily, serif = C.serifFamily;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 16 }}>
        <span style={{ fontFamily: serif, fontSize: 42, fontWeight: 500, letterSpacing: "-0.04em", color: C.text, fontVariantNumeric: "tabular-nums", lineHeight: 0.9 }}>1.05</span>
        <span style={{ fontFamily: mono, fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>acute : chronic</span>
      </div>
      <div style={{ position: "relative", height: 6, background: C.line, marginBottom: 7 }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: "16.7%", right: "25%", background: C.lineBright }} />
        {["16.7%", "58.3%", "75%"].map((l, i) => <div key={i} style={{ position: "absolute", top: -2, bottom: -2, left: l, width: 1, background: C.textFaint }} />)}
        <div style={{ position: "absolute", top: -3, bottom: -3, left: "calc(37.5% - 1px)", width: 2, background: C.text }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textFaint }}>
        <span>Under</span><span>Optimal</span><span>Over</span><span>Risk</span>
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.03em", color: C.textDim, marginTop: 12, fontVariantNumeric: "tabular-nums" }}>Acute 412 · Chronic 392 · Monotony 1.4</div>
    </div>
  );
}

function FuelMock({ C }) {
  const mono = C.monoFamily;
  const macros = [["Protein", "182 / 200 g", 91], ["Carbs", "310 / 400 g", 78], ["Fats", "78 / 95 g", 82], ["Calories", "2,840 / 3,400", 84], ["Water", "96 / 128 oz", 75]];
  return (
    <div>
      {macros.map((m, i) => (
        <div key={i}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: mono, fontSize: 13, letterSpacing: "0.03em", margin: "11px 0 5px" }}>
            <span style={{ textTransform: "uppercase", color: C.textDim }}>{m[0]}</span>
            <span style={{ color: C.text, fontVariantNumeric: "tabular-nums" }}>{m[1]}</span>
          </div>
          <div style={{ height: 2, background: C.line }}><div style={{ height: "100%", width: `${m[2]}%`, background: C.text }} /></div>
        </div>
      ))}
    </div>
  );
}

function BlockMock({ C }) {
  const mono = C.monoFamily;
  const wks = [["W1", 58, false], ["W2", 80, false], ["W3", 100, true], ["W4", 42, false]];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 9, height: 72 }}>
        {wks.map((w, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            <div style={{ width: "100%", minHeight: 4, height: `${w[1]}%`, background: w[2] ? C.text : C.lineBright }} />
            <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.05em", color: w[2] ? C.text : C.textFaint, marginTop: 6 }}>{w[0]}</span>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.03em", color: C.textDim, marginTop: 12 }}>Base · Build · Intensify · Deload</div>
      <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.03em", color: C.text, marginTop: 4 }}>Week 3 of 4 — Intensify</div>
    </div>
  );
}

function TrendMock({ C }) {
  const mono = C.monoFamily;
  return (
    <div>
      <svg viewBox="0 0 240 78" style={{ width: "100%", height: "auto", display: "block" }} aria-hidden="true">
        <line x1="0" y1="69" x2="240" y2="69" stroke={C.line} strokeWidth="1" />
        <polyline points="0,34 26,26 52,38 78,20 104,30 130,16 156,30 182,22 208,14 240,22" fill="none" stroke={C.text} strokeWidth="1.5" />
        <polyline points="0,50 26,54 52,46 78,52 104,42 130,48 156,40 182,50 208,44 240,52" fill="none" stroke={C.textFaint} strokeWidth="1.5" strokeDasharray="3 3" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textFaint, marginTop: 9 }}>
        <span>— Recovery</span><span>·· Load · 14d</span>
      </div>
    </div>
  );
}

function CoachMock({ C }) {
  const mono = C.monoFamily, serif = C.serifFamily;
  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 13.5, color: C.textDim, marginBottom: 13, paddingBottom: 13, borderBottom: `1px solid ${C.line}`, lineHeight: 1.5 }}>"Legs are smoked. Should I still squat today?"</div>
      <div style={{ fontFamily: serif, fontSize: 15.5, lineHeight: 1.45, color: C.text }}>Readiness is 58 — moderate. Keep squats but cap top sets at RPE 7, cut the running finisher, and add 20 g protein at dinner.</div>
    </div>
  );
}

const HYBRID = [
  ["Strength", "PPL + Arms splits, double progression, two-a-day AM/PM sessions."],
  ["Race plan", "Set a 5K, 10K or half and the weeks to race day build themselves around your lifting."],
  ["Running", "Polarized programming — easy volume protected, hard days earned."],
  ["Recovery", "Deloads triggered by your acute : chronic ratio, not a fixed week four."],
  ["Fuel", "Daily macros, protein from bodyweight, and a supplement checklist."],
];

const TRUST_RAIL = [
  ["Today", "one daily call"],
  ["Recovery", "manual + wearable"],
  ["Fuel", "macro targets"],
  ["Progress", "proof over vibes"],
  ["Profile", "program · data · privacy"],
];

const PRIVACY_LEDGER = [
  ["Account", "Username + password/recovery phrase. No public real-world identity required."],
  ["Wearables", "Oura and Whoop are opt-in. Tokens stay server-side and are deleted when disconnected."],
  ["Coach", "Receives a compact, sanitized training/recovery summary — not OAuth tokens or full raw logs."],
  ["Form Check", "Keeps derived summaries such as tempo, depth and bar path; raw videos are not stored."],
  ["Social", "Leaderboards and PR boards are opt-in and show only handle-level aggregate stats."],
];

function TrustRail({ C }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", borderTop: `1px solid ${C.line}`, borderLeft: `1px solid ${C.line}`, marginTop: 24 }}>
      {TRUST_RAIL.map(([k, v]) => (
        <div key={k} style={{ borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, padding: "10px 12px" }}>
          <div style={{ fontFamily: C.monoFamily, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.text }}>{k}</div>
          <div style={{ fontFamily: C.monoFamily, fontSize: 10.5, letterSpacing: "0.04em", color: C.textFaint, marginTop: 4 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function LedgerList({ C, rows }) {
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 26 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(92px, 0.32fr) 1fr", gap: 16, padding: "13px 0", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: C.monoFamily, fontSize: 11.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.text }}>{k}</div>
          <div style={{ fontFamily: C.fontFamily, fontSize: 14.5, lineHeight: 1.55, color: C.textDim }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

export default function DemoPage({ onClose }) {
  const { C } = useTheme();
  const serif = C.serifFamily, mono = C.monoFamily, sans = C.fontFamily;
  const [rec, setRec] = useState(76);
  const [acwr, setAcwr] = useState(1.05);
  const stressRef = useRef(0.06);

  const sig = computeReadinessIndex(rec, { ratio: acwr }, null);
  const idx = sig ? sig.index : 0;
  const band = bandFor(idx);

  const sectionPad = { padding: "52px 24px", borderTop: `1px solid ${C.line}`, maxWidth: 880, margin: "0 auto" };
  const head = { fontFamily: serif, fontWeight: 500, fontSize: "clamp(26px,4.4vw,38px)", lineHeight: 1.05, letterSpacing: "-0.025em", marginBottom: 14, color: C.text };
  const lede = { fontFamily: sans, fontSize: 16.5, lineHeight: 1.62, color: C.textDim, maxWidth: "60ch" };
  const btn = { fontFamily: mono, fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase", padding: "14px 22px", border: `1px solid ${C.text}`, background: C.text, color: C.bg, textDecoration: "none", cursor: "pointer", display: "inline-block" };

  return (
    <div role="dialog" aria-label="0VERTRAINED demo" style={{ position: "fixed", inset: 0, background: C.bg, color: C.text, zIndex: 1000, overflowY: "auto", fontFamily: sans }}>
      {/* Masthead */}
      <div style={{ position: "sticky", top: 0, background: C.bg, borderBottom: `1px solid ${C.line}`, zIndex: 5 }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em", color: C.text }}><span style={{ fontFamily: serif, fontStyle: "italic", fontWeight: 500 }}>θ</span>VERTRAINED</span>
            <span style={{ fontFamily: mono, fontSize: 11.5, letterSpacing: "0.22em", textTransform: "uppercase", color: C.textFaint, marginLeft: 14 }}>Training Ledger</span>
          </span>
          <button type="button" onClick={onClose} style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim, background: "none", border: `1px solid ${C.lineBright}`, padding: "7px 13px", cursor: "pointer" }}>✕ Close</button>
        </div>
      </div>

      {/* Hero */}
      <div style={{ position: "relative", overflow: "hidden" }}>
        <FlowField C={C} stressRef={stressRef} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 880, margin: "0 auto", padding: "44px 24px 50px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 36, alignItems: "center" }}>
            <div style={{ flex: "1 1 320px" }}>
              <span style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: C.textFaint }}>An evidence-based readiness engine</span>
              <h1 style={{ fontFamily: serif, fontWeight: 500, fontSize: "clamp(38px,6.4vw,60px)", lineHeight: 0.98, letterSpacing: "-0.035em", margin: "14px 0 20px", color: C.text }}>Should you go hard today?</h1>
              <p style={{ fontFamily: sans, fontSize: 18, lineHeight: 1.6, color: C.textDim, maxWidth: "50ch", marginBottom: 28 }}>
                0VERTRAINED reads recovery, load, fuel and program context to make one clear call every morning — <span style={{ color: C.text, fontWeight: 500 }}>push, hold, or back off</span> — then shows the ledger behind it. Built for athletes who lift and race, with Oura/Whoop optional and manual logging still first-class. <span style={{ color: C.text, fontWeight: 500 }}>Private by design. No black box.</span>
              </p>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <a style={btn} href={SIGNUP_URL}>Request early access</a>
              </div>
              <TrustRail C={C} />
            </div>
            <div style={{ flex: "1 1 300px" }}>
              <ReadinessSpecimen C={C} stressRef={stressRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Fig 01 — problem */}
      <div style={sectionPad}>
        <Eyebrow C={C} fig="Fig. 01" name="The problem" />
        <h2 style={head}>Tracking isn't coaching.</h2>
        <p style={lede}>Your watch and your spreadsheet hand you a hundred numbers and leave the judgment to you. On a heavy week, that's exactly how you overreach. <span style={{ color: C.text }}>0VERTRAINED reads the same signals and makes one call</span> — then shows the reasoning, so you're never taking it on faith.</p>
      </div>

      {/* Fig 02 — interactive engine */}
      <div style={sectionPad}>
        <Eyebrow C={C} fig="Fig. 02" name="The engine" />
        <h2 style={{ ...head, marginBottom: 8 }}>Move the inputs. Watch the call.</h2>
        <p style={{ ...lede, marginBottom: 34 }}>This is the real model that runs in the app every morning — recovery sets the ceiling, training load discounts it as your acute : chronic ratio climbs.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 40, alignItems: "center" }}>
          <div style={{ flex: "1 1 280px" }}>
            <div style={{ marginBottom: 26 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <label htmlFor="demo-rec" style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim }}>Recovery</label>
                <span style={{ fontFamily: serif, fontSize: 22, fontWeight: 500, color: C.text, fontVariantNumeric: "tabular-nums" }}>{rec}<span style={{ fontFamily: mono, fontSize: 13.5, color: C.textFaint }}> /100</span></span>
              </div>
              <input id="demo-rec" type="range" min="10" max="100" step="1" value={rec} onChange={(e) => setRec(+e.target.value)} style={{ width: "100%", accentColor: C.text }} />
              <div style={{ fontFamily: mono, fontSize: 11.5, letterSpacing: "0.04em", color: C.textFaint, marginTop: 8 }}>Sleep, soreness, energy — or HRV, resting HR and sleep from Oura.</div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <label htmlFor="demo-acwr" style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim }}>Acute : chronic load</label>
                <span style={{ fontFamily: serif, fontSize: 22, fontWeight: 500, color: C.text, fontVariantNumeric: "tabular-nums" }}>{acwr.toFixed(2)}</span>
              </div>
              <input id="demo-acwr" type="range" min="0.6" max="1.8" step="0.01" value={acwr} onChange={(e) => setAcwr(+e.target.value)} style={{ width: "100%", accentColor: C.text }} />
              <div style={{ fontFamily: mono, fontSize: 11.5, letterSpacing: "0.04em", color: C.textFaint, marginTop: 8 }}>Below 1.3 is the sweet spot. Above it, fatigue is outrunning fitness.</div>
            </div>
            <div style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.03em", lineHeight: 1.6, color: C.textFaint, marginTop: 18, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
              index = clamp((recovery − 35) / 50) × load discount, mapped to a band with hysteresis.
            </div>
          </div>
          <div style={{ flex: "1 1 300px" }}>
            <ReadinessCard C={C} index={idx} band={band} stat={LABEL[band]} reason={null} />
            <div aria-live="polite" className="sr-only">{`Readiness index ${idx}, ${LABEL[band]}. ${recPhrase(rec)}; ${loadPhrase(acwr)}.`}</div>
          </div>
        </div>
      </div>

      {/* Fig 03 — the whole ledger */}
      <div style={sectionPad}>
        <Eyebrow C={C} fig="Fig. 03" name="The whole ledger" />
        <h2 style={{ ...head, marginBottom: 8 }}>Readiness is the call. This is the rest of the instrument.</h2>
        <p style={{ ...lede, marginBottom: 28 }}>Today, Recovery, Fuel, Progress and Profile now read like one ruled ledger: every surface uses the same ink, type, hairlines and source disclosure language.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", borderTop: `1px solid ${C.line}`, borderLeft: `1px solid ${C.line}` }}>
          <Plate C={C} label="Workout log" caption="Log lifts, runs, notes and check-ins in seconds. Every set and mile feeds the load model."><LogMock C={C} /></Plate>
          <Plate C={C} label="Training load" caption="An EWMA acute:chronic ratio with monotony — overreaching flagged before it becomes a lost week."><LoadMock C={C} /></Plate>
          <Plate C={C} label="Fuel" caption="Macros, protein scaled to bodyweight, hydration and meal plans — tuned to the day's work."><FuelMock C={C} /></Plate>
          <Plate C={C} label="Program" caption="Generated weekly programming with editable splits, equipment, cardio preference and deload logic."><BlockMock C={C} /></Plate>
          <Plate C={C} label="Wearables + trends" caption="Oura and Whoop can sync in the background, but manual recovery remains first-class."><TrendMock C={C} /></Plate>
          <Plate C={C} label="Coach + form check" caption="A server-side coach and movement analyzer read derived summaries, not secrets or raw videos."><CoachMock C={C} /></Plate>
        </div>
      </div>

      {/* Fig 04 — hybrid */}
      <div style={sectionPad}>
        <Eyebrow C={C} fig="Fig. 04" name="Built for hybrid athletes" />
        <h2 style={head}>Lift and race, on one ledger.</h2>
        <p style={{ ...lede, marginBottom: 18 }}>Most tools assume you only do one. 0VERTRAINED is built for the athlete carrying a barbell and a race bib in the same week — and it models the load from both.</p>
        <ul style={{ listStyle: "none", marginTop: 8 }}>
          {HYBRID.map(([k, d]) => (
            <li key={k} style={{ display: "flex", flexWrap: "wrap", gap: 14, padding: "13px 0", borderBottom: `1px solid ${C.line}`, alignItems: "baseline" }}>
              <span style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase", color: C.text, minWidth: 110 }}>{k}</span>
              <span style={{ fontFamily: sans, fontSize: 15, color: C.textDim, lineHeight: 1.5, flex: 1 }}>{d}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Fig 05 — privacy */}
      <div style={sectionPad}>
        <Eyebrow C={C} fig="Fig. 05" name="Yours, privately" />
        <h2 style={head}>Your log is yours.</h2>
        <p style={lede}>The app is designed around data minimization: collect what is needed to coach the athlete, expose source provenance, and keep sharing opt-in. The legal pages mirror this boundary in plain language. <span style={{ color: C.text }}>No ads. We don't sell your data.</span></p>
        <LedgerList C={C} rows={PRIVACY_LEDGER} />
      </div>

      {/* Closing */}
      <div style={{ borderTop: `1px solid ${C.line}`, textAlign: "center", padding: "70px 24px" }}>
        <h2 style={{ fontFamily: serif, fontWeight: 500, fontSize: "clamp(30px,6vw,50px)", lineHeight: 1, letterSpacing: "-0.03em", marginBottom: 14, color: C.text }}>Train by evidence.</h2>
        <p style={{ fontFamily: sans, color: C.textDim, fontSize: 17, maxWidth: "46ch", margin: "0 auto 28px" }}>Early access is opening to a first group of hybrid athletes. Put your name down and we'll be in touch.</p>
        <a style={{ ...btn, fontSize: 13.5 }} href={SIGNUP_URL}>Request early access</a>
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${C.line}`, maxWidth: 880, margin: "0 auto", padding: "30px 24px 56px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 16, color: C.text }}><span style={{ fontFamily: serif, fontStyle: "italic", fontWeight: 500 }}>θ</span>VERTRAINED</span>
          <span style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: C.textFaint }}>Training Ledger · Est. 2026</span>
        </span>
        <span style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <a href="/legal/privacy-policy.html" style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim, textDecoration: "none" }}>Privacy</a>
          <a href="/legal/terms-of-service.html" style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textDim, textDecoration: "none" }}>Terms</a>
          <button type="button" onClick={onClose} style={{ fontFamily: mono, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim, background: "none", border: "none", cursor: "pointer" }}>Back to app →</button>
        </span>
      </div>
    </div>
  );
}
