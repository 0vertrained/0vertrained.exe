// Panel 5 of the Stats tab: the first page of the quest log, newest first,
// each row a button to the day-detail sheet, and a ghost "View all" when
// the log runs past the page. Reads the engine through useGame itself, so
// the Stats screen hands it only the day and two callbacks.
import { useGame } from "../../app/useGame";
import { Button } from "../../design/Button";
import { Panel } from "../../design/Panel";
import type { DateKey } from "../../domain/dates";
import styles from "./log.module.css";
import { LogRows } from "./LogRows";
import { LOG_PAGE, logCount, logRows } from "./logView";

export interface QuestLogPanelProps {
  todayKey: DateKey;
  /** Rows shown; 20 by default. */
  limit?: number;
  onOpen: (dateKey: DateKey) => void;
  /** Wired to a ghost "View all", shown only when the log has more rows than `limit`. */
  onViewAll?: () => void;
}

export function QuestLogPanel({ todayKey, limit = LOG_PAGE, onOpen, onViewAll }: QuestLogPanelProps) {
  const progress = useGame(todayKey);
  const rows = logRows(progress, { limit });
  const more = logCount(progress) > limit;
  return (
    <Panel title="Quest log">
      {rows.length === 0 ? <p className="ot-small ot-ink-2 ot-m0">Nothing logged yet.</p> : <LogRows rows={rows} onOpen={onOpen} />}
      {more && onViewAll ? (
        <Button variant="ghost" full className={styles.more} onClick={onViewAll}>View all</Button>
      ) : null}
    </Panel>
  );
}
