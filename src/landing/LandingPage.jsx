// src/landing/LandingPage.jsx
// V13.2 · The logged-out landing as the paper's front matter: masthead, title
// block + Abstract, Fig. 1 live specimen, Fig. 2 method, Fig. 3 data sources,
// Fig. 4 Google user-data disclosure, colophon. This page is the homepage URL
// submitted on the Google OAuth consent screen, so it must keep satisfying
// Google's API-verification homepage checklist:
//   · publicly visible without login (rendered before the auth gate)
//   · describes the app's functionality (the Abstract)
//   · explains why Google user data is requested + how it's used (Fig. 4)
//   · links the privacy policy + terms (masthead AND colophon)
//   · carries the Limited Use disclosure (Fig. 4 footnote)
// src/__tests__/landingCompliance.test.jsx locks these in — if you edit the
// strings below, keep the privacy policy and that test in lockstep.
import { useTheme } from "../theme";
import { ProvisionalTag } from "../ui/primitives";
import { ReadinessSpecimen } from "./ReadinessSpecimen";

// ── Compliance copy (exported so the test suite can lock the exact strings) ──
export const ABSTRACT_TEXT =
  "0VERTRAINED is a private training ledger for hybrid athletes. You log strength, cardio, nutrition, body metrics, and daily recovery check-ins — or import them from a wearable — and the app reconciles training load against sleep, HRV, and fueling to answer one question each morning: how hard should today be? An optional AI Coach and camera-based Form Check give feedback on request; both are opt-in and off by default.";

export const GOOGLE_DATA_ROWS = [
  ["We access", "With your permission, 0VERTRAINED connects to your Google account to read Fitbit health and activity data: sleep, heart rate and HRV, resting heart rate, respiratory rate, SpO2, steps, active minutes and Active Zone Minutes, calories, and exercise sessions."],
  ["Only to", "Power the features you see in the app — your recovery and readiness scores, training-load analysis, daily verdicts, trends, and (only if you separately opt in) AI Coach summaries. Nothing else."],
  ["Never", "Google user data is never sold, never used for advertising, and never used to train generalized AI or machine-learning models."],
  ["Your control", "Connecting is optional and the app is fully functional without it. Disconnect anytime in Settings → Integrations — this deletes your Google tokens and imported Fitbit data from the app. You can also revoke access from your Google Account permissions page."],
];

const POLICY_NAME = "Google API Services User Data Policy";
const POLICY_URL = "https://developers.google.com/terms/api-services-user-data-policy";
export const LIMITED_USE_DISCLOSURE =
  `0VERTRAINED's use and transfer to any other app of information received from Google APIs will adhere to the ${POLICY_NAME}, including the Limited Use requirements.`;

// Centralized so the public colophon, beta dead ends, About screen, and error
// reports all use the exact support address configured for OAuth verification.
import { SUPPORT_EMAIL } from "../appMeta";

const METHOD_STEPS = [
  ["01 · Log", "Strength, cardio, nutrition, body metrics, and daily recovery check-ins — typed in, or imported from a source you connect."],
  ["02 · Reconcile", "Training load is compared against sleep, HRV, fueling, and your own rolling baselines — not population averages."],
  ["03 · Decide", "One verdict each morning — push, hold, or back off — with the limiter that set it printed right on the call."],
];

const SOURCE_ROWS = [
  ["Manual", "First-class logging with nothing connected. The app is fully functional on manual entry alone.", false],
  ["Oura + Whoop", "Sleep, recovery, HRV, strain, and readiness context.", false],
  ["Fitbit by Google", "Sleep, heart rate, activity, and health metrics, read from your Google account with your permission.", true],
  ["Strava", "Runs, rides, GPS sessions, distance, pace, and elevation.", false],
];

export function Wordmark({ size = 20, compact = false }) {
  const { S } = useTheme();
  return (
    <span style={{ ...S.wordmark, fontSize: size, gap: compact ? 0 : 1 }}>
      <span style={{ ...S.wordmarkTheta, fontSize: size * 1.08 }}>θ</span>
      <span>VERTRAINED</span>
    </span>
  );
}

function FigHead({ title, stat }) {
  const { S } = useTheme();
  return (
    <div style={{ ...S.blockHead, marginBottom: 10 }}>
      <span style={S.blockTitle}>{title}</span>
      {stat && <span style={S.blockStat}>{stat}</span>}
    </div>
  );
}

export default function LandingPage() {
  const { C, S } = useTheme();
  const mono = C.monoFamily;
  const serif = C.serifFamily;
  const rule = `1px solid ${C.line}`;

  const navLinkStyle = {
    fontFamily: mono,
    fontSize: 10.5,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: C.textDim,
    textDecoration: "none",
    padding: "8px 0",
  };

  const primaryCta = {
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.bg,
    background: C.text,
    textDecoration: "none",
    padding: "12px 15px",
    border: `1px solid ${C.text}`,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
  };

  const secondaryCta = {
    ...primaryCta,
    color: C.text,
    background: "transparent",
    border: `1px solid ${C.lineBright}`,
  };

  const footLink = { fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textDim, textDecoration: "none" };

  return (
    <section aria-label="About 0VERTRAINED" style={{ display: "flex", flexDirection: "column", gap: 26, minWidth: 0 }}>
      {/* ── Masthead ── */}
      <nav aria-label="Public links" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, borderTop: rule, borderBottom: rule, padding: "10px 0" }}>
        <Wordmark size={18} compact />
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "10px 18px" }}>
          <a href="#/demo" style={navLinkStyle}>Demo</a>
          <a href="/legal/privacy-policy.html" style={navLinkStyle}>Privacy</a>
          <a href="/legal/terms-of-service.html" style={navLinkStyle}>Terms</a>
          <a href="#signin" style={{ ...navLinkStyle, color: C.text }}>Sign in ↓</a>
        </div>
      </nav>

      {/* ── Title block + Abstract ── */}
      <div style={{ borderBottom: rule, paddingBottom: 26 }}>
        <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textFaint, marginBottom: 18 }}>
          Public beta · A training ledger for hybrid athletes
        </div>
        <h1 style={{ fontFamily: serif, fontWeight: 500, letterSpacing: "-0.058em", lineHeight: 0.92, fontSize: "clamp(50px, 8.5vw, 104px)", color: C.text, margin: 0 }}>
          Train hard.<br />Recover honestly.
        </h1>
        <div style={{ ...S.blockTitle, marginTop: 24, paddingTop: 12, borderTop: rule, maxWidth: 690 }}>Abstract</div>
        <p style={{ fontFamily: serif, fontStyle: "italic", fontSize: "clamp(15.5px, 1.7vw, 17.5px)", lineHeight: 1.55, color: C.textDim, maxWidth: 690, margin: "10px 0 0" }}>
          {ABSTRACT_TEXT}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 24 }}>
          <a href="#/demo" style={primaryCta}>View live demo</a>
          <a href="#signin" style={secondaryCta}>Sign in / create account</a>
        </div>
      </div>

      {/* ── Fig. 1 · The daily verdict (live specimen) ── */}
      <section aria-label="The daily verdict — live specimen">
        <FigHead title="Fig. 1 · The daily verdict" stat="live engine · specimen" />
        <ReadinessSpecimen C={C} />
        <div style={S.figureCaption}>The same readiness call the app makes each morning, cycling four real scenarios.</div>
      </section>

      {/* ── Fig. 2 · Method ── */}
      <section aria-label="Method">
        <FigHead title="Fig. 2 · Method" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", borderTop: rule, borderLeft: rule }}>
          {METHOD_STEPS.map(([title, body]) => (
            <article key={title} style={{ padding: "16px 15px 17px", borderRight: rule, borderBottom: rule }}>
              <h2 style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: C.text, margin: "0 0 8px", fontWeight: 500 }}>{title}</h2>
              <p style={{ margin: 0, color: C.textDim, lineHeight: 1.5, fontSize: 13.5 }}>{body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Fig. 3 · Data sources ── */}
      <section aria-label="Data sources">
        <FigHead title="Fig. 3 · Data sources" stat="all optional" />
        <p style={{ margin: "0 0 12px", color: C.textDim, lineHeight: 1.5, fontSize: 13.5, maxWidth: 690 }}>
          Optional inputs, not requirements. Connect a source when it helps; disconnecting deletes what it imported.
        </p>
        <div style={{ borderTop: rule }}>
          {SOURCE_ROWS.map(([label, body, soon]) => (
            <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 0.34fr) minmax(0, 1fr)", gap: 14, padding: "11px 0", borderBottom: rule, alignItems: "baseline" }}>
              <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
                {label}
                {/* Remove the tag in the same PR that flips the Google Health
                    feature flag live — the homepage in the verification demo
                    video should describe present-tense functionality. */}
                {soon && <ProvisionalTag>Coming soon</ProvisionalTag>}
              </span>
              <span style={{ color: C.textDim, lineHeight: 1.45, fontSize: 13.5 }}>{body}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Fig. 4 · Google user data (verification disclosure) ── */}
      <section id="google-data" aria-label="Google user data" style={{ border: rule, background: C.panel, padding: "15px 16px 13px" }}>
        <FigHead title="Fig. 4 · Google user data" stat="disclosure" />
        <div>
          {GOOGLE_DATA_ROWS.map(([label, body]) => (
            <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(105px, 0.26fr) minmax(0, 1fr)", gap: 14, padding: "10px 0", borderTop: rule, alignItems: "baseline" }}>
              <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text }}>{label}</span>
              <span style={{ color: C.textDim, lineHeight: 1.5, fontSize: 13.5 }}>{body}</span>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: mono, fontSize: 11, color: C.textFaint, lineHeight: 1.65, borderTop: rule, paddingTop: 10, marginTop: 2, letterSpacing: "0.02em" }}>
          † {LIMITED_USE_DISCLOSURE.split(POLICY_NAME)[0]}
          <a href={POLICY_URL} target="_blank" rel="noopener noreferrer" style={{ color: C.textDim, textDecoration: "underline", textUnderlineOffset: 2 }}>{POLICY_NAME}</a>
          {LIMITED_USE_DISCLOSURE.split(POLICY_NAME)[1]}
        </div>
      </section>

      {/* ── Colophon ── */}
      <footer aria-label="Colophon" style={{ borderTop: rule, paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px 18px" }}>
        <span style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", alignItems: "baseline" }}>
          <a href="/legal/privacy-policy.html" style={footLink}>Privacy</a>
          <a href="/legal/terms-of-service.html" style={footLink}>Terms</a>
          {SUPPORT_EMAIL && <a href={`mailto:${SUPPORT_EMAIL}`} style={footLink}>{SUPPORT_EMAIL}</a>}
        </span>
        <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textFaint }}>
          Not medical advice · © 2026 0VERTRAINED
        </span>
      </footer>
    </section>
  );
}
