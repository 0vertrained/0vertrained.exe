// Landing: the idea in one screen and one tap in. The playground runs the
// real tier table, so a visitor sees how a rough night changes the day
// before they have an account. "Sign in" waits for the new backend.
import { useState } from "react";
import { Button } from "../../design/Button";
import { Panel } from "../../design/Panel";
import { SegmentedControl } from "../../design/SegmentedControl";
import { TierBadge } from "../../design/TierBadge";
import { Wordmark } from "../../design/Wordmark";
import { CHECKIN_ROWS } from "../../domain/readiness/checkin";
import styles from "./LandingScreen.module.css";
import { PLAYGROUND_DEFAULTS, playgroundDecision, playgroundSentence, type PlaygroundAnswers } from "./playground";

export interface LandingScreenProps {
  onDemo: () => void;
  onFresh: () => void;
  busy?: boolean;
}

const BENEFITS = ["Daily quests sized to how you feel", "Rest days pay XP too", "Works offline, at the rack"];

export function LandingScreen({ onDemo, onFresh, busy }: LandingScreenProps) {
  const [answers, setAnswers] = useState<PlaygroundAnswers>(PLAYGROUND_DEFAULTS);
  const decision = playgroundDecision(answers);
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <Wordmark size={56} />
        <p className={`ot-body ot-ink-2 ${styles.tagline}`}>A daily quest sized to how you feel. Level up. Never overtrain.</p>
      </header>

      <Panel as="section" title="How do you feel today?">
        <p className={`ot-small ot-ink-2 ${styles.rule}`}>A check-in can only lower today&rsquo;s quest, never raise it.</p>
        <div className={styles.rows}>
          {CHECKIN_ROWS.map((row) => (
            <SegmentedControl
              key={row.field}
              inline
              label={row.label}
              options={row.options.map((o) => ({ value: String(o.value), label: o.text }))}
              value={String(answers[row.field] ?? "")}
              onChange={(v) => setAnswers((a) => ({ ...a, [row.field]: Number(v) }))}
            />
          ))}
        </div>
        <div className={styles.result} aria-live="polite">
          <span className="ot-small-strong">Today:</span>
          <TierBadge tier={decision.tier} />
          <span className="ot-small ot-ink-2">{playgroundSentence(decision)}</span>
        </div>
      </Panel>

      <ul className={styles.benefits}>
        {BENEFITS.map((b) => <li key={b} className="ot-body">{b}</li>)}
      </ul>

      <div className={styles.actions}>
        <Button variant="primary" full size="lg" onClick={onDemo} loading={busy}>Try the demo</Button>
        <Button variant="secondary" full onClick={onFresh} disabled={busy}>Start fresh</Button>
        <p className={`ot-caption ot-ink-3 ${styles.signin}`}>
          <button type="button" className="ot-link" disabled aria-describedby="signin-note">Sign in</button>
          <span id="signin-note"> Accounts arrive with the next release. Guest progress stays on this device.</span>
        </p>
      </div>

      <footer className={`ot-caption ot-ink-3 ${styles.footer}`}>
        <a href="/legal/privacy-policy.html">Privacy</a>
        <a href="/legal/terms-of-service.html">Terms</a>
        <a href="https://github.com/0vertrained/0vertrained.exe" rel="noreferrer">Source</a>
      </footer>
    </main>
  );
}
