// The Profile tab: one autosaving page of Panels. Program (the week, the
// generator and the presets, all effective tomorrow), Settings (units,
// bodyweight, the session switches, the pause), Data (backup in and out,
// the reset) and About. No Save button anywhere; the only modals are the
// sheets a row opens and the confirms before a program change or a reset.
// Guest mode has no account, so there is no Sign out.
import { useGame } from "../../app/useGame";
import { Panel } from "../../design/Panel";
import type { DateKey } from "../../domain/dates";
import { allowanceLeft } from "../quest/questView";
import { AccountPanel } from "./AccountPanel";
import { DataPanel } from "./DataPanel";
import styles from "./ProfileScreen.module.css";
import { ProgramPanel } from "./ProgramPanel";
import { SettingsPanel } from "./SettingsPanel";

export interface ProfileScreenProps {
  todayKey: DateKey;
}

export function ProfileScreen({ todayKey }: ProfileScreenProps) {
  const progress = useGame(todayKey);
  return (
    <>
      <div className={styles.head}>
        <h1 className="ot-title ot-screen-title">Profile</h1>
      </div>
      <ProgramPanel todayKey={todayKey} />
      <SettingsPanel todayKey={todayKey} allowance={allowanceLeft(progress, todayKey)} />
      <AccountPanel />
      <DataPanel todayKey={todayKey} />
      <AboutPanel />
    </>
  );
}

function AboutPanel() {
  return (
    <Panel title="About">
      <div className={styles.about}>
        <p className={styles.aboutRow}>
          <span className="ot-small ot-ink-2">Version</span>
          <span className="ot-numeral">{__APP_VERSION__}</span>
        </p>
        <p className="ot-small ot-ink-2">Guest mode: everything stays on this device.</p>
        <p className="ot-caption ot-ink-2">
          <a className="ot-link" href="/legal/privacy-policy.html" target="_blank" rel="noreferrer">Privacy policy</a>
          {" · "}
          <a className="ot-link" href="/legal/terms-of-service.html" target="_blank" rel="noreferrer">Terms of service</a>
        </p>
      </div>
    </Panel>
  );
}
