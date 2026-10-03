// #/stats/log: the whole quest log, 20 rows a page with a ghost "Next 20"
// appending the next page, and #/stats/log/<date> the same screen with that
// day's detail sheet open. Opening a row pushes the date onto the route and
// closing replaces it, so the browser's Back closes the sheet. Rendered
// inside the Shell on the Stats tab, so it carries only its own title.
import { useCallback, useState } from "react";
import { useGame } from "../../app/useGame";
import { useHashRoute } from "../../app/useHashRoute";
import { Button } from "../../design/Button";
import { EmptyState } from "../../design/EmptyState";
import { Panel } from "../../design/Panel";
import { isDateKey, type DateKey } from "../../domain/dates";
import { DayDetailSheet } from "./DayDetailSheet";
import styles from "./log.module.css";
import { LogRows } from "./LogRows";
import { LOG_PAGE, logCount, logRows } from "./logView";

export interface QuestLogScreenProps {
  todayKey: DateKey;
}

export function QuestLogScreen({ todayKey }: QuestLogScreenProps) {
  const progress = useGame(todayKey);
  const { route, navigate } = useHashRoute();
  const [limit, setLimit] = useState(LOG_PAGE);
  const rows = logRows(progress, { limit });
  const remaining = logCount(progress) - rows.length;
  const requested = route.parts[2];
  const open = requested !== undefined && isDateKey(requested) ? requested : null;
  const close = useCallback(() => navigate("/stats/log", { replace: true }), [navigate]);

  return (
    <>
      <div className={styles.head}>
        <h1 className="ot-title ot-screen-title">Quest log</h1>
        <Button variant="ghost" onClick={() => navigate("/stats")}>Back to stats</Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          tag="QUEST"
          title="Nothing logged yet."
          body="Your first check-in starts the log."
          action={{ label: "Back to quest", variant: "secondary", onClick: () => navigate("/quest") }}
        />
      ) : (
        <Panel aria-label="Quest log">
          <LogRows rows={rows} onOpen={(key) => navigate(`/stats/log/${key}`)} />
          {remaining > 0 ? (
            <Button variant="ghost" full className={styles.more} onClick={() => setLimit((n) => n + LOG_PAGE)}>
              Next {Math.min(LOG_PAGE, remaining)}
            </Button>
          ) : null}
        </Panel>
      )}

      {open ? <DayDetailSheet todayKey={todayKey} dateKey={open} onClose={close} /> : null}
    </>
  );
}
