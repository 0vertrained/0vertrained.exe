import { useState, useRef, useCallback } from "react";
import { useMediaQuery, BROADSHEET_QUERY } from "./ui/useMediaQuery";
import { useTheme } from "./theme";
import { listProtocols, getProtocol, DEFAULT_MOVEMENT } from "./formCheck/protocols";
import { analyzeLocalVideo } from "./formCheck/localVideoAnalyzer";
import { VIDEO_LIMITS } from "./formCheck/videoValidation";
import { buildSummaryEntry, saveSummary } from "./formCheck/formCheckHistory";

// Form Check V1.2 — polished coaching-grade movement form review.
// The selected/recorded video is read locally for metadata, then sent to the
// hosted Form Check Engine for temporary analysis. The server deletes the video
// immediately and returns derived results only. V1.2 adds formScore, captureQuality,
// coaching-tier messaging, confidence breakdowns, and next-set guidance.

const PROCESSING_STEPS = [
  "Reading clip metadata…",
  "Checking duration, size, and framing…",
  "Uploading securely to hosted engine…",
  "Analyzing movement path…",
  "Building conservative cues…",
];

export function FormCheck() {
  const { C, S } = useTheme();
  const mono = C.fontFamily;
  const annot = C.monoFamily || mono;

  const [movement, setMovement] = useState(DEFAULT_MOVEMENT);
  const [phase, setPhase] = useState("idle"); // idle | processing | done | error
  const [analysis, setAnalysis] = useState(null);
  const isBroadsheet = useMediaQuery(BROADSHEET_QUERY); // V16.4 · workspace split (mockup 1o)
  const [error, setError] = useState("");
  const [guidance, setGuidance] = useState([]);
  const [processingStep, setProcessingStep] = useState(PROCESSING_STEPS[0]);
  const fileRef = useRef(null);
  const uploadRef = useRef(null);

  const protocol = getProtocol(movement);
  const protocols = listProtocols();

  const reset = useCallback(() => {
    setPhase("idle");
    setAnalysis(null);
    setError("");
    setGuidance([]);
    setProcessingStep(PROCESSING_STEPS[0]);
    if (fileRef.current) fileRef.current.value = "";
    if (uploadRef.current) uploadRef.current.value = "";
  }, []);

  const onPick = useCallback(
    async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      setPhase("processing");
      setProcessingStep(PROCESSING_STEPS[0]);
      setError("");
      setGuidance([]);
      setAnalysis(null);
      try {
        setTimeout(() => setProcessingStep(PROCESSING_STEPS[1]), 120);
        setTimeout(() => setProcessingStep(PROCESSING_STEPS[2]), 500);
        setTimeout(() => setProcessingStep(PROCESSING_STEPS[3]), 1200);
        const out = await analyzeLocalVideo({ file, movement });
        setProcessingStep(PROCESSING_STEPS[4]);
        if (out.status === "invalid") {
          setError(out.validation?.message || "That clip can't be used.");
          setGuidance(out.validation?.retakeTips || []);
          setPhase("error");
        } else {
          setAnalysis(out);
          setPhase("done");
        }
      } catch {
        setError("Something went wrong reading that video. Please try again.");
        setGuidance(["Use a short 5–12 second side-view clip and try again."]);
        setPhase("error");
      } finally {
        // Allow re-selecting the same file later.
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [movement],
  );

  const sectionLabel = {
    fontFamily: annot,
    fontSize: 10.5,
    letterSpacing: "0.16em",
    color: C.textDim,
    textTransform: "uppercase",
    fontWeight: 500,
    marginBottom: 8,
  };
  const card = {
    border: `1px solid ${C.line}`,
    background: C.cell,
    padding: 14,
    marginBottom: 14,
  };
  const body = { fontFamily: mono, fontSize: 13.5, color: C.text, lineHeight: 1.55 };
  const dim = { fontFamily: mono, fontSize: 13, color: C.textDim, lineHeight: 1.6 };

  return (
    <div style={{ padding: 16, fontFamily: mono, color: C.text }}>
      {/* V16.4 · Form workspace (mockup 1o): capture stage left, findings
          docked right at the tier; below it, both wrappers are contents and
          the flow is byte-identical. */}
      <div style={isBroadsheet ? { display: "grid", gridTemplateColumns: "1fr 560px", gap: 20, alignItems: "start" } : { display: "contents" }}>
      <section data-section="form-stage" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>
      <div style={card}>
        <div style={sectionLabel}>Movement</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {protocols.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setMovement(p.key);
                reset();
              }}
              style={{
                padding: "8px 12px",
                background: movement === p.key ? C.text : C.inputBg,
                color: movement === p.key ? C.bg : C.text,
                border: `1px solid ${C.line}`,
                fontFamily: annot,
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...card, borderStyle: "dashed" }}>
        <div style={{ ...dim, fontSize: 11.5 }}>
          🔒 Private by design. Your clip is uploaded over HTTPS for temporary hosted analysis,
          then <strong style={{ color: C.text }}>deleted immediately</strong>. The app stores only
          derived summaries you choose to save — never the video.
        </div>
      </div>

      <div style={card}>
        <div style={sectionLabel}>Guided Capture — {protocol.label}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <GuideChip C={C} mono={mono} label="Clip" value={`${VIDEO_LIMITS.minIdealDurationSec}–${VIDEO_LIMITS.idealDurationSec}s`} />
          <GuideChip C={C} mono={mono} label="Reps" value={protocol.repsGuidance.replace(/^Record\s*/i, "")} />
          <GuideChip C={C} mono={mono} label="Angle" value="Side view" />
          <GuideChip C={C} mono={mono} label="Frame" value="Full movement" />
        </div>
        <ol style={{ margin: "0 0 8px", paddingLeft: 18 }}>
          {protocol.cameraSetup.map((step, i) => (
            <li key={i} style={{ ...body, marginBottom: 5 }}>
              {step}
            </li>
          ))}
        </ol>
        <div style={{ ...dim, marginTop: 8 }}>Ideal: 5–12 seconds, steady camera, only the working set.</div>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {protocol.recordingTips.map((tip, i) => (
            <li key={i} style={{ ...dim, marginBottom: 4 }}>
              {tip}
            </li>
          ))}
        </ul>
        {protocol.whatWeLookAt?.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ ...sectionLabel, marginBottom: 6 }}>What V1.1 can estimate</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {protocol.whatWeLookAt.map((item, i) => (
                <li key={i} style={{ ...dim, marginBottom: 4 }}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {phase !== "done" && (
        <div style={card}>
          <div style={sectionLabel}>Record or Upload</div>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            capture="environment"
            onChange={onPick}
            style={{ display: "none" }}
            id="form-check-video-input"
          />
          <input
            ref={uploadRef}
            type="file"
            accept="video/*"
            onChange={onPick}
            style={{ display: "none" }}
            id="form-check-upload-input"
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => fileRef.current && fileRef.current.click()}
              disabled={phase === "processing"}
              style={{ ...S.foodBtn, marginTop: 0, opacity: phase === "processing" ? 0.6 : 1 }}
            >
              {phase === "processing" ? "Analyzing…" : "Guided Record"}
            </button>
            <button
              onClick={() => uploadRef.current && uploadRef.current.click()}
              disabled={phase === "processing"}
              style={{
                ...S.foodBtn,
                marginTop: 0,
                opacity: phase === "processing" ? 0.6 : 1,
                background: C.inputBg,
                color: C.text,
              }}
            >
              📁 Upload Clip
            </button>
          </div>
          <div style={{ ...dim, fontSize: 11, marginTop: 8 }}>
            Hard limit: {VIDEO_LIMITS.maxDurationSec}s / {VIDEO_LIMITS.maxBytes / 1024 / 1024}MB. Shorter clips upload faster and analyze better.
          </div>
          {phase === "error" && (
            <div style={{ marginTop: 10 }}>
              <div style={{ ...body, color: C.text, fontSize: 13 }}>⚠ {error}</div>
              <RetakeTips tips={guidance} C={C} mono={mono} />
            </div>
          )}
        </div>
      )}

      {phase === "processing" && (
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ ...body, marginBottom: 4 }}>{processingStep}</div>
          <div style={dim}>Local metadata first. Temporary hosted analysis second. No video is stored.</div>
        </div>
      )}

      </section>
      <section data-section="form-results" style={isBroadsheet ? { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } : { display: "contents" }}>
      {isBroadsheet && !(phase === "done" && analysis) && (
        <div style={S.block} data-section="form-results-hint">
          <div style={S.blockHead}><span style={S.blockTitle}>{"> "}Findings</span></div>
          <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.5 }}>Record or upload a set on the left — the rep-by-rep analysis docks here when it lands.</div>
        </div>
      )}
      {phase === "done" && analysis && (
        <ResultCard analysis={analysis} onRetake={reset} C={C} S={S} mono={mono} annot={annot} />
      )}
      </section>
      </div>
    </div>
  );
}

function GuideChip({ C, mono, label, value }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, background: C.inputBg, padding: "7px 8px" }}>
      <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 13, color: C.text, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function RetakeTips({ tips, C, mono }) {
  if (!Array.isArray(tips) || tips.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontFamily: mono, fontSize: 11.5, color: C.textDim, marginBottom: 4 }}>Try this next:</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {tips.slice(0, 4).map((tip, i) => (
          <li key={i} style={{ fontFamily: mono, fontSize: 12, color: C.textDim, marginBottom: 3, lineHeight: 1.5 }}>
            {tip}
          </li>
        ))}
      </ul>
    </div>
  );
}


function AnalyzabilityCard({ analyzability, C, mono, annot }) {
  // V1.5: Capture-quality gate shown at the very top of the result. Derived only.
  if (!analyzability || !analyzability.level) return null;
  const level = analyzability.level;
  const score = Number.isFinite(analyzability.score) ? analyzability.score : null;
  const blocking = Array.isArray(analyzability.blockingIssues) ? analyzability.blockingIssues : [];
  const improvements = Array.isArray(analyzability.improvements) ? analyzability.improvements : [];

  const LABEL = { strong: "Strong capture", usable: "Usable capture", weak: "Weak capture", retake: "Retake suggested" };
  const tone = level === "strong" ? C.green : level === "usable" ? C.text : level === "weak" ? C.lineBright : C.red;
  const border = level === "weak" || level === "retake" ? tone : C.line;

  return (
    <div style={{ border: `2px solid ${border}`, background: C.inputBg, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: blocking.length || improvements.length ? 8 : 0 }}>
        <div style={{ fontFamily: annot, fontSize: 10, color: tone, textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 600 }}>
          {LABEL[level] || "Capture quality"}
        </div>
        {score != null && <div style={{ fontFamily: mono, fontSize: 14, color: C.text, fontWeight: 600 }}>{score}<span style={{ fontSize: 11, color: C.textDim }}>/100</span></div>}
      </div>
      {blocking.length > 0 && (
        <ul style={{ margin: "0 0 6px", paddingLeft: 16 }}>
          {blocking.slice(0, 4).map((b, i) => (
            <li key={i} style={{ fontFamily: mono, fontSize: 12, color: C.text, lineHeight: 1.5, marginBottom: 3 }}>{b}</li>
          ))}
        </ul>
      )}
      {improvements.length > 0 && (level === "weak" || level === "retake") && (
        <div>
          <div style={{ fontFamily: annot, fontSize: 9.5, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 3 }}>To improve the next take</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {improvements.slice(0, 4).map((t, i) => (
              <li key={i} style={{ fontFamily: mono, fontSize: 11.5, color: C.textDim, lineHeight: 1.45, marginBottom: 3 }}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {analyzability.shouldShowFullCoaching === false && (
        <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim, fontStyle: "italic", marginTop: 7, lineHeight: 1.45 }}>
          Detailed coaching below is shown cautiously — capture quality was limited.
        </div>
      )}
    </div>
  );
}

function MovementMetricsCard({ movementMetrics, C, mono, annot }) {
  // V1.7: Conservative movement-accuracy proxies. All values are derived scores.
  if (!movementMetrics || typeof movementMetrics !== "object") return null;
  const entries = Object.entries(movementMetrics).filter(([, m]) => m && Number.isFinite(m.score)).slice(0, 6);
  if (entries.length === 0) return null;

  const humanize = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

  return (
    <div style={{ border: `1px solid ${C.line}`, background: C.inputBg, padding: 12, marginBottom: 12 }}>
      <div style={{ fontFamily: annot, fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 500, marginBottom: 8 }}>Movement Consistency (est.)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {entries.map(([key, m]) => (
          <div key={key} style={{ border: `1px solid ${C.line}`, padding: "6px 8px" }}>
            <div style={{ fontFamily: annot, fontSize: 9.5, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>{humanize(key)}</div>
            <div style={{ fontFamily: mono, fontSize: 13.5, color: C.text }}>{m.score}<span style={{ fontSize: 10, color: C.textDim }}> {m.label ? String(m.label).replace(/-/g, " ") : ""}</span></div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: mono, fontSize: 10.5, color: C.textDim, lineHeight: 1.4, marginTop: 7, fontStyle: "italic" }}>
        Single-angle estimates from joint motion — directional proxies, not measurements.
      </div>
    </div>
  );
}

function FormScoreCard({ formScore, confidence, metricConfidence, C, mono, annot }) {
  // V1.2: Show form score (0-100) and analysis confidence separately.
  if (!formScore && !confidence) return null;
  
  const scoreNum = typeof formScore === "number" ? formScore : Number.isFinite(formScore?.score) ? formScore.score : null;
  const scoreLabel = typeof formScore === "object" ? formScore?.label : null;
  const scoreReasons = Array.isArray(formScore?.reasons) ? formScore.reasons : [];
  const confScore = typeof confidence?.score === "number" ? Math.round(confidence.score * 100) : null;
  const metricVals = metricConfidence && typeof metricConfidence === "object"
    ? Object.values(metricConfidence).map(v => v?.confidence).filter(v => Number.isFinite(v))
    : [];
  const avgMetricConfidence = metricVals.length
    ? Math.round((metricVals.reduce((a, b) => a + b, 0) / metricVals.length) * 100)
    : confScore;
  
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {scoreNum != null && (
          <div style={{ border: `1px solid ${C.line}`, background: C.inputBg, padding: 12 }}>
            <div style={{ fontFamily: annot, fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: 4 }}>Form Score</div>
            <div style={{ fontFamily: mono, fontSize: 28, fontWeight: 600, color: C.text }}>{scoreNum}</div>
            <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim, marginTop: 2 }}>
              /100{scoreLabel ? ` · ${String(scoreLabel).replace(/_/g, " ")}` : ""}
            </div>
          </div>
        )}
        {avgMetricConfidence != null && (
          <div style={{ border: `1px solid ${C.line}`, background: C.inputBg, padding: 12 }}>
            <div style={{ fontFamily: annot, fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: 4 }}>Read Confidence</div>
            <div style={{ fontFamily: mono, fontSize: 28, fontWeight: 600, color: C.text }}>{avgMetricConfidence}</div>
            <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim, marginTop: 2 }}>% metric average</div>
          </div>
        )}
      </div>
      {scoreReasons.length > 0 && (
        <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim, marginTop: 7, lineHeight: 1.45 }}>
          Why: {scoreReasons.slice(0, 2).join(" · ")}
        </div>
      )}
    </div>
  );
}

function TopPriorityCard({ cues, coaching, C, mono, annot }) {
  // V1.2: Prefer backend coaching.topPriority, fall back to highest-priority cue.
  const watchCue = Array.isArray(cues) ? cues.find(c => c.severity === "watch") : null;
  const text = coaching?.topPriority || watchCue?.text;
  if (!text) return null;
  
  return (
    <div style={{ border: `2px solid ${C.lineBright}`, background: C.inputBg, padding: 12, marginBottom: 12 }}>
      <div style={{ fontFamily: annot, fontSize: 10, color: C.lineBright, textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 600, marginBottom: 6 }}>↳ Top Priority</div>
      <div style={{ fontFamily: mono, fontSize: 13.5, color: C.text, lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}

function WhatLookedGoodCard({ cues, coaching, C, mono, annot }) {
  // V1.2: Prefer coaching.whatLookedGood, fall back to positive/info cues.
  const coachingItems = Array.isArray(coaching?.whatLookedGood) ? coaching.whatLookedGood : [];
  const infoCues = Array.isArray(cues) ? cues.filter(c => c.severity === "info").map(c => c.text) : [];
  const items = [...coachingItems, ...infoCues].filter(Boolean).slice(0, 4);
  if (items.length === 0) return null;
  
  return (
    <div style={{ border: `1px solid ${C.line}`, background: C.inputBg, padding: 12, marginBottom: 12 }}>
      <div style={{ fontFamily: annot, fontSize: 10, color: C.text, textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 500, marginBottom: 6 }}>✓ What Looked Good</div>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {items.map((item, i) => (
          <li key={i} style={{ fontFamily: mono, fontSize: 13, color: C.text, lineHeight: 1.55, marginBottom: i < items.length - 1 ? 5 : 0 }}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WatchItemsCard({ cues, coaching, C, mono, annot }) {
  // V1.2: Prefer coaching.watchItems, fall back to watch/caution cues.
  const coachingItems = Array.isArray(coaching?.watchItems) ? coaching.watchItems : [];
  const cueItems = Array.isArray(cues) ? cues.filter(c => c.severity === "watch" || c.severity === "caution").map(c => c.text) : [];
  const items = [...coachingItems, ...cueItems].filter(Boolean).slice(0, 4);
  if (items.length === 0) return null;
  
  return (
    <div style={{ border: `1px solid ${C.lineBright}`, background: C.inputBg, padding: 12, marginBottom: 12 }}>
      <div style={{ fontFamily: annot, fontSize: 10, color: C.lineBright, textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 500, marginBottom: 6 }}>⚠ Items to Watch</div>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {items.map((item, i) => (
          <li key={i} style={{ fontFamily: mono, fontSize: 13, color: C.text, lineHeight: 1.55, marginBottom: i < items.length - 1 ? 5 : 0 }}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NextSetCueCard({ coaching, C, mono, annot }) {
  // V1.2: Show coaching-tier "before next set" guidance
  if (!coaching?.nextSetCue) return null;
  
  return (
    <div style={{ border: `1px dashed ${C.line}`, background: C.inputBg, padding: 12, marginBottom: 12 }}>
      <div style={{ fontFamily: annot, fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 500, marginBottom: 6 }}>Before Your Next Set</div>
      <div style={{ fontFamily: mono, fontSize: 13, color: C.text, lineHeight: 1.6, fontStyle: "italic" }}>{coaching.nextSetCue}</div>
    </div>
  );
}

function CaptureQualityCard({ captureQuality, C, mono, annot }) {
  // V1.2: Show capture quality breakdown. Supports backend {score,label,checks[]}
  // and legacy mock {lighting,framing,...} shapes.
  if (!captureQuality) return null;
  
  const items = [];
  if (Array.isArray(captureQuality.checks)) {
    captureQuality.checks.forEach(check => {
      items.push({
        label: check.item || "Check",
        value: check.status || "noted",
        note: check.note || null,
      });
    });
  } else {
    if (captureQuality.lighting) items.push({ label: "Lighting", value: captureQuality.lighting });
    if (captureQuality.framing) items.push({ label: "Framing", value: captureQuality.framing });
    if (captureQuality.motionBlur) items.push({ label: "Motion Blur", value: captureQuality.motionBlur });
    if (captureQuality.bodyVisibility) items.push({ label: "Body Visibility", value: captureQuality.bodyVisibility });
    if (captureQuality.overallQuality) items.push({ label: "Overall", value: captureQuality.overallQuality });
  }
  
  if (items.length === 0 && !Number.isFinite(captureQuality.score)) return null;
  
  return (
    <div style={{ border: `1px solid ${C.line}`, background: C.inputBg, padding: 12, marginBottom: 12 }}>
      <div style={{ fontFamily: annot, fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 500, marginBottom: 8 }}>Capture Quality</div>
      {Number.isFinite(captureQuality.score) && (
        <div style={{ fontFamily: mono, fontSize: 13.5, color: C.text, marginBottom: 8 }}>
          {captureQuality.score}/100{captureQuality.label ? ` · ${captureQuality.label}` : ""}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {items.map((item, i) => (
          <div key={i} style={{ fontSize: 11.5 }}>
            <div style={{ fontFamily: annot, fontSize: 9.5, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>{String(item.label).replace(/_/g, " ")}</div>
            <div style={{ fontFamily: mono, fontSize: 13, color: C.text, textTransform: "capitalize" }}>{item.value}</div>
            {item.note && <div style={{ fontFamily: mono, fontSize: 10.5, color: C.textDim, lineHeight: 1.35, marginTop: 2 }}>{item.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidenceCard({ evidence, C, mono, annot }) {
  // V1.3: Derived evidence only — timestamps/labels/metrics, never images or landmarks.
  if (!evidence) return null;
  const keyMoments = Array.isArray(evidence.keyMoments) ? evidence.keyMoments.slice(0, 6) : [];
  const highlights = Array.isArray(evidence.metricHighlights) ? evidence.metricHighlights.slice(0, 4) : [];
  const limitations = Array.isArray(evidence.limitations) ? evidence.limitations.slice(0, 3) : [];
  if (!evidence.summary && keyMoments.length === 0 && highlights.length === 0 && limitations.length === 0) return null;

  const fmtTime = (ms) => Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "—";

  return (
    <div style={{ border: `1px solid ${C.line}`, background: C.inputBg, padding: 12, marginBottom: 12 }}>
      <div style={{ fontFamily: annot, fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 500, marginBottom: 7 }}>Evidence</div>
      {evidence.summary && <div style={{ fontFamily: mono, fontSize: 12, color: C.text, lineHeight: 1.5, marginBottom: 9 }}>{evidence.summary}</div>}
      {keyMoments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 9 }}>
          {keyMoments.map((m, i) => (
            <div key={`${m.label || m.phase || "moment"}-${i}`} style={{ border: `1px solid ${C.line}`, padding: "5px 7px", minWidth: 78 }}>
              <div style={{ fontFamily: annot, fontSize: 9.5, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>{m.label || m.phase || "moment"}</div>
              <div style={{ fontFamily: mono, fontSize: 13, color: C.text }}>{fmtTime(m.tMs ?? m.timeMs ?? m.timestampMs ?? m.startMs)}</div>
              {Number.isFinite(m.confidence) && <div style={{ fontFamily: mono, fontSize: 10.5, color: C.textDim }}>{Math.round(m.confidence * 100)}% read</div>}
            </div>
          ))}
        </div>
      )}
      {highlights.length > 0 && (
        <ul style={{ margin: "0 0 8px", paddingLeft: 16 }}>
          {highlights.map((h, i) => (
            <li key={i} style={{ fontFamily: mono, fontSize: 11.5, color: C.text, lineHeight: 1.45, marginBottom: 3 }}>
              {h.label || h.name || "Metric"}{Number.isFinite(h.value) ? `: ${h.value}${h.unit || ""}` : ""}{h.observation ? ` — ${h.observation}` : ""}
            </li>
          ))}
        </ul>
      )}
      {limitations.length > 0 && (
        <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim, lineHeight: 1.45 }}>
          Limits: {limitations.join(" · ")}
        </div>
      )}
    </div>
  );
}

function ProgressSignalsCard({ progressSignals, C, mono, annot }) {
  // V1.3: Compact progress-memory surface. All values are derived and safe to save.
  if (!progressSignals) return null;
  const metrics = Array.isArray(progressSignals.comparableMetrics) ? progressSignals.comparableMetrics.slice(0, 5) : [];
  const components = Array.isArray(progressSignals.scoreComponents) ? progressSignals.scoreComponents.slice(0, 4) : [];
  if (!progressSignals.primaryFocus && metrics.length === 0 && components.length === 0) return null;

  return (
    <div style={{ border: `1px dashed ${C.line}`, background: C.inputBg, padding: 12, marginBottom: 12 }}>
      <div style={{ fontFamily: annot, fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 500, marginBottom: 7 }}>Progress Signals</div>
      {progressSignals.primaryFocus && (
        <div style={{ fontFamily: mono, fontSize: 13, color: C.text, lineHeight: 1.5, marginBottom: 7 }}>
          Primary focus: {String(progressSignals.primaryFocus).replace(/_/g, " ")}
        </div>
      )}
      {metrics.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: components.length ? 8 : 0 }}>
          {metrics.map((m, i) => (
            <div key={`${m.name || "metric"}-${i}`} style={{ border: `1px solid ${C.line}`, padding: "5px 7px" }}>
              <div style={{ fontFamily: annot, fontSize: 9.5, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>{String(m.name || "metric").replace(/_/g, " ")}</div>
              <div style={{ fontFamily: mono, fontSize: 13, color: C.text }}>{Number.isFinite(m.value) ? `${m.value}${m.unit || ""}` : "—"}</div>
            </div>
          ))}
        </div>
      )}
      {components.length > 0 && (
        <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim, lineHeight: 1.45 }}>
          Components: {components.map(c => `${String(c.name || "score").replace(/_/g, " ")}${Number.isFinite(c.score) ? ` ${c.score}` : ""}`).join(" · ")}
        </div>
      )}
    </div>
  );
}

// Short, hedged labels for the per-rep timeline chips across movements.
const DEPTH_LABEL = {
  "at-or-below-parallel": "Deep",
  "near-parallel": "~Parallel",
  "above-parallel": "Shallow",
  "clear-hinge": "Hinge",
  "partial-hinge": "Partial",
  "minimal-hinge": "Shallow",
  deep: "Deep",
  near: "Near",
  shallow: "Shallow",
  "full-range": "Full",
  "partial-range": "Partial",
  "limited-range": "Limited",
  "stable-hinge": "Stable",
  "drifting-hinge": "Drift",
  estimated: "Est.",
  unknown: "—",
};

function ResultCard({ analysis, onRetake, C, S, mono, annot }) {
  const { result, metadata, status, segmentation } = analysis;
  const lowConfidence = !result?.assessable || result?.confidence?.level === "low";
  const [saved, setSaved] = useState(false);

  const onSave = useCallback(() => {
    // Derived summary only — never the video, frames, or landmarks. The history
    // helper allow-lists fields, so this stays local + privacy-safe.
    const entry = buildSummaryEntry(analysis, new Date().toISOString());
    saveSummary(entry);
    setSaved(true);
  }, [analysis]);

  const card = { border: `1px solid ${C.line}`, background: C.cell, padding: 14, marginBottom: 14 };
  const label = {
    fontFamily: annot,
    fontSize: 10.5,
    letterSpacing: "0.16em",
    color: C.textDim,
    textTransform: "uppercase",
    fontWeight: 500,
    marginBottom: 8,
  };
  const body = { fontFamily: mono, fontSize: 13.5, color: C.text, lineHeight: 1.55 };
  const dim = { fontFamily: mono, fontSize: 13, color: C.textDim, lineHeight: 1.6 };

  const reps = segmentation?.reps || [];
  const showTimeline = !lowConfidence && reps.length > 0;
  const tips = analysis.retakeTips || [];
  const warnings = analysis.warnings || analysis.validation?.warnings || [];
  
  // V1.2: Extract new coaching fields
  const formScore = analysis.formScore;
  const captureQuality = analysis.captureQuality;
  const coaching = analysis.coaching;
  const metricConfidence = analysis.metricConfidence;
  const evidence = analysis.evidence;
  const progressSignals = analysis.progressSignals;
  // V1.5/V1.7: capture-quality gate + movement-accuracy proxies
  const analyzability = analysis.analyzability;
  const movementMetrics = analysis.movementMetrics;

  return (
    <div style={card}>
      <div style={label}>Result — {result?.movement || "movement"}</div>

      {/* V1.5: Capture-quality gate + retake coach, above the form score */}
      <AnalyzabilityCard analyzability={analyzability} C={C} mono={mono} annot={annot} />

      {/* V1.2: Form Score + Metric Confidence at the top */}
      <FormScoreCard formScore={formScore} confidence={result?.confidence} metricConfidence={metricConfidence} C={C} mono={mono} annot={annot} />

      {/* V1.2: Show "What Looked Good" before warnings/issues */}
      <WhatLookedGoodCard cues={result?.cues} coaching={coaching} C={C} mono={mono} annot={annot} />

      {/* V1.2: Top Priority item */}
      <TopPriorityCard cues={result?.cues} coaching={coaching} C={C} mono={mono} annot={annot} />

      {/* V1.2: Watch items (other cautions) */}
      <WatchItemsCard cues={result?.cues} coaching={coaching} C={C} mono={mono} annot={annot} />

      {warnings.length > 0 && (
        <div style={{ border: `1px solid ${C.line}`, background: C.inputBg, padding: 10, marginBottom: 10 }}>
          <div style={{ ...label, marginBottom: 5 }}>Clip notes</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.map((w, i) => <li key={i} style={{ ...dim, marginBottom: 3 }}>{w}</li>)}
          </ul>
        </div>
      )}

      <div style={{ ...body, marginBottom: 10 }}>{result.summary}</div>

      {/* V1.7: Movement-accuracy consistency proxies */}
      <MovementMetricsCard movementMetrics={movementMetrics} C={C} mono={mono} annot={annot} />

      {/* V1.3: Evidence + progress memory */}
      <EvidenceCard evidence={evidence} C={C} mono={mono} annot={annot} />
      <ProgressSignalsCard progressSignals={progressSignals} C={C} mono={mono} annot={annot} />

      {/* V1.2: Capture quality breakdown */}
      <CaptureQualityCard captureQuality={captureQuality} C={C} mono={mono} annot={annot} />

      {/* V1.2: Next set cue / coaching guidance */}
      <NextSetCueCard coaching={coaching} C={C} mono={mono} annot={annot} />

      {showTimeline && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...label, marginBottom: 8 }}>Rep Timeline — {segmentation.repCount} estimated</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {reps.map((rep) => (
              <div
                key={rep.index}
                style={{
                  border: `1px solid ${rep.flags?.length ? C.lineBright : C.line}`,
                  background: C.inputBg,
                  padding: "6px 8px",
                  minWidth: 72,
                }}
              >
                <div style={{ ...dim, fontSize: 11, letterSpacing: "0.08em" }}>REP {rep.index}</div>
                <div style={{ ...body, fontSize: 13, fontWeight: 500 }}>{DEPTH_LABEL[rep.depthAssessment] || "Est."}</div>
                <div style={{ ...dim, fontSize: 11 }}>{rep.tempoSec ? `${rep.tempoSec.toFixed(1)}s` : "—"}</div>
                <div style={{ ...dim, fontSize: 11 }}>{rep.quality ? `${rep.quality} quality` : "estimated"}</div>
                {/* V1.2: Show enriched rep notes if present */}
                {rep.repNote && <div style={{ ...dim, fontSize: 10.5, marginTop: 3, fontStyle: "italic" }}>{rep.repNote}</div>}
              </div>
            ))}
          </div>
          <div style={{ ...dim, fontSize: 11, marginTop: 6 }}>
            Hosted-engine estimate — chips show rough depth, tempo, and per-rep confidence.
          </div>
        </div>
      )}

      {!lowConfidence && reps.length === 0 && segmentation?.reason && (
        <div style={{ ...dim, fontSize: 11.5, marginBottom: 12 }}>
          Couldn't cleanly separate individual reps. For a rep-by-rep timeline, film a steady side view of a few controlled reps.
        </div>
      )}

      {lowConfidence && result?.confidence?.reasons?.length > 0 && (
        <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
          {result.confidence.reasons.map((r, i) => (
            <li key={i} style={{ ...dim, marginBottom: 4 }}>{r}</li>
          ))}
        </ul>
      )}

      {(tips.length > 0 || status === "unavailable" || coaching?.retakeRecommendation) && (
        <div style={{ border: `1px dashed ${C.line}`, padding: 10, marginBottom: 10 }}>
          {status === "unavailable" && (
            <div style={{ ...dim, fontSize: 11.5, marginBottom: 6 }}>
              The hosted form check engine could not produce a confident result. Your clip is not stored.
            </div>
          )}
          {/* V1.2: Show retake recommendation from coaching */}
          {coaching?.retakeRecommendation && (
            <div style={{ ...body, fontSize: 13, color: C.lineBright, marginBottom: tips.length > 0 ? 8 : 0 }}>
              📹 {coaching.retakeRecommendation}
            </div>
          )}
          <RetakeTips tips={tips} C={C} mono={mono} />
        </div>
      )}

      {metadata && (metadata.durationSec || metadata.width) && (
        <div style={{ ...dim, fontSize: 11, marginBottom: 10 }}>
          Clip: {metadata.durationSec ? `${metadata.durationSec.toFixed(1)}s` : "—"}
          {metadata.width ? ` · ${metadata.width}×${metadata.height}` : ""} (metadata read locally)
        </div>
      )}

      {result?.disclaimer && <div style={{ ...dim, fontSize: 11, fontStyle: "italic", marginBottom: 12 }}>{result.disclaimer}</div>}

      {!lowConfidence && (
        <>
          <button
            onClick={onSave}
            disabled={saved}
            style={{ ...S.foodBtn, marginTop: 0, marginBottom: 8, opacity: saved ? 0.6 : 1, cursor: saved ? "default" : "pointer" }}
          >
            {saved ? "✓ Saved to Progress" : "Save Summary to Progress"}
          </button>
          <div style={{ ...dim, fontSize: 11, marginBottom: 12 }}>
            {saved
              ? "Saved on this device. Only the derived summary (reps, cues, confidence) is stored — your video is not."
              : "Saves only the derived summary to this device. The hosted engine deletes the video after processing."}
          </div>
        </>
      )}

      <button onClick={onRetake} style={{ ...S.foodBtn, marginTop: 0 }}>Retake / New Clip</button>
    </div>
  );
}
