// src/landing/LandingPage.jsx
// The public home page: what the app is, a sample of the daily call, what it
// does, where its numbers come from and how private it is. The privacy policy
// and terms are linked from the privacy section and from the footer.
// src/__tests__/landingCompliance.test.jsx locks these in.
import { Wordmark } from "../ui/ledger";
import { SampleMornings } from "./ReadinessSpecimen";
import { PRIVACY_HREF, PublicFooter, TERMS_HREF } from "./PublicFooter";

export const ABSTRACT_TEXT =
  "A private training ledger for people who lift and run. Log or import your training, recovery and food, and get one evidence-based answer each morning.";

const FEATURES = [
  ["Today", "One call each morning, with the evidence behind it."],
  ["Train", "A lifting week, and a race plan for a 5K, 10K or half marathon, in one place."],
  ["Fuel", "Protein and calories left today, and the next meal that closes the gap."],
  ["Progress", "Strength, running and body trends over weeks and months."],
  ["Coach", "An AI coach that answers questions about your own training. During the beta it is by invitation."],
];

const SOURCES = [
  ["Typed in", "Everything works with nothing connected."],
  ["Oura and Whoop", "Sleep, HRV, resting heart rate, strain and readiness, if you connect them."],
  ["Strava", "Runs and rides with distance, pace and elevation, if you connect it."],
];

const PRIVACY = [
  "No feed, no leaderboards, no ads.",
  "No email needed: a username, a password and a recovery phrase.",
  "Wearable tokens stay on the server and are deleted when you disconnect.",
  "Export everything at any time.",
];

export default function LandingPage() {
  return (
    <div className="shell">
      <header className="top">
        <span className="grow" style={{ display: "flex" }}><Wordmark /></span>
        <a className="btn btn-s btn-sm" href="#signin">Sign in</a>
        <span style={{ width: 12, flex: "none" }} />
      </header>
      <main className="main" style={{ gap: 40, paddingTop: 24, paddingBottom: 40 }}>
        <section aria-labelledby="home-title" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 24, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h1 id="home-title" className="t-xl" tabIndex={-1}>How hard should today be?</h1>
            <p className="t-read">{ABSTRACT_TEXT}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <a className="btn btn-p btn-lg btn-b" href="#/demo">Try the demo</a>
              <a className="btn btn-s btn-b" href="#signin">Sign in</a>
            </div>
            <p className="t-s c2">The demo needs no account. Places in the beta are limited.</p>
          </div>
          <SampleMornings />
        </section>

        <section aria-labelledby="home-what" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id="home-what" className="t-title">What it does</h2>
          <dl className="rows" style={{ margin: 0 }}>
            {FEATURES.map(([name, text]) => (
              <div key={name} className="kv" style={{ padding: "4px 0" }}>
                <dt className="t-bs">{name}</dt>
                <dd className="t-b c2" style={{ margin: 0 }}>{text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="home-sources" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id="home-sources" className="t-title">Where the numbers come from</h2>
          <ul className="rows" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {SOURCES.map(([name, text]) => (
              <li key={name} className="kv" style={{ padding: "4px 0" }}>
                <span className="t-bs">{name}</span>
                <span className="t-b c2">{text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="home-private" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id="home-private" className="t-title">Private by design</h2>
          <ul className="lst lst-b" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {PRIVACY.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="t-b">Read the <a className="u" href={PRIVACY_HREF}>privacy policy</a> and the <a className="u" href={TERMS_HREF}>terms</a>.</p>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
