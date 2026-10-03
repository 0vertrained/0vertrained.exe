// The Quest tab: the day's quest card, the week strip and one notice.
// Nothing else on the page. The card's one button comes from the engine's
// next-action state machine; this phase wires Check in and Claim rewards,
// the runners arrive with the next one.
import { useCallback, useState } from "react";
import { useAppData } from "../../data/useAppData";
import { Button } from "../../design/Button";
import { Notice } from "../../design/Notice";
import { ObjectiveRow } from "../../design/ObjectiveRow";
import { Panel } from "../../design/Panel";
import { TierBadge } from "../../design/TierBadge";
import { WeekStrip } from "../../design/WeekStrip";
import type { DateKey } from "../../domain/dates";
import type { CheckIn, QuestSnapshot } from "../../domain/day/schema";
import type { Progress } from "../../domain/game/types";
import { useHashRoute } from "../../app/useHashRoute";
import { useToast } from "../../app/ToastProvider";
import { CheckinSheet } from "./CheckinSheet";
import styles from "./QuestScreen.module.css";
import { questView } from "./questView";

export interface QuestScreenProps {
  progress: Progress;
  todayKey: DateKey;
}

function longDate(key: DateKey): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

export function QuestScreen({ progress, todayKey }: QuestScreenProps) {
  const { state, updateDay } = useAppData();
  const { sheet, openSheet, closeSheet } = useHashRoute();
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const day = state.days[todayKey];
  const view = questView({ progress, todayKey, day, days: state.days, program: state.program });

  const onCheckin = useCallback((checkin: CheckIn, quest: QuestSnapshot) => {
    updateDay(todayKey, (d) => ({ ...d, checkin, quest }));
    setClosing(true);
    closeSheet();
  }, [closeSheet, todayKey, updateDay]);

  const claim = () => {
    const at = new Date().toISOString();
    updateDay(todayKey, (d) => (d.quest ? { ...d, quest: { ...d.quest, claimedAt: at } } : d));
  };

  const recovery = () => {
    updateDay(todayKey, (d) => (d.quest ? { ...d, quest: { ...d.quest, recoveryDone: true } } : d));
  };

  const act = () => {
    switch (view.action.key) {
      case "checkin":
        setClosing(false);
        openSheet("checkin");
        return;
      case "claim":
        claim();
        return;
      case "recovery":
        recovery();
        return;
      case "begin":
      case "continue":
      case "cardio":
        toast.show({ tag: "QUEST", text: "The session runner arrives with the next release. Your quest is issued and waiting." });
        return;
      default:
        return;
    }
  };

  const showCheckin = sheet === "checkin" && !closing && view.planned && state.program;

  return (
    <>
      <div className={styles.head}>
        <h1 className="ot-title ot-screen-title">Quest</h1>
        <span className="ot-caption ot-ink-2">{longDate(todayKey)}</span>
      </div>

      <Panel as="section" aria-label="Daily quest">
        <div className={styles.cardHead}>
          <TierBadge tier={view.tier} size="lg" />
          <span className="ot-numeral-sm ot-ink-2">+{view.potentialXp} XP today</span>
        </div>
        <p className={`ot-body ot-ink-2 ${styles.reason}`}>{view.reason}</p>
        <div>
          {view.objectives.map((o) => (
            <ObjectiveRow key={o.key} label={o.label} {...(o.sublabel ? { sublabel: o.sublabel } : {})} state={o.state} {...(o.progress !== undefined ? { progress: o.progress } : {})} {...(o.xp !== undefined ? { xp: o.xp } : {})} />
          ))}
        </div>
        {view.action.key !== "none" ? (
          <div className={styles.action}>
            <Button variant="primary" full disabled={!view.action.primary} onClick={act}>{view.action.label}</Button>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <WeekStrip days={view.days.map(({ label, name, state: s, today, xp }) => ({ label, name, state: s, ...(today ? { today } : {}), ...(xp !== undefined ? { xp } : {}) }))} {...(view.weekly ? { weekly: view.weekly } : {})} />
      </Panel>

      {view.notice ? <Notice tag={view.notice.tag}>{view.notice.text}</Notice> : null}

      {showCheckin && view.planned && state.program ? (
        <CheckinSheet todayKey={todayKey} day={day} days={state.days} program={state.program} planned={view.planned} allowanceLeft={view.allowanceLeft} trial={progress.trial} onClose={closeSheet} onDone={onCheckin} />
      ) : null}
    </>
  );
}
