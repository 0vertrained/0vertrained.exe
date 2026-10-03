// The Stats tab: the status block (name, featured title, rank, level line,
// XP bar, the next rank's checklist and, only when the trial is available,
// the page's one primary), three stat tiles, records, titles and the quest
// log slot. Every sheet it opens is a history entry (openSheet) and closes
// with closeSheet. While older history is still paging in, skeletons.
import { useCallback, useMemo, type ReactNode } from "react";
import { useToast } from "../../app/ToastProvider";
import { metaFor, useGame } from "../../app/useGame";
import { useHashRoute } from "../../app/useHashRoute";
import { useAppData } from "../../data/useAppData";
import { Button } from "../../design/Button";
import { cx } from "../../design/cx";
import { EmptyState } from "../../design/EmptyState";
import { Icon } from "../../design/Icon";
import { ObjectiveRow } from "../../design/ObjectiveRow";
import { Panel } from "../../design/Panel";
import { ProgressBar } from "../../design/ProgressBar";
import { RankBadge } from "../../design/RankBadge";
import { Skeleton } from "../../design/Skeleton";
import { StatTile } from "../../design/StatTile";
import { addDays, type DateKey } from "../../domain/dates";
import { ExplainSheet } from "./ExplainSheet";
import { RankTrialSheet } from "./RankTrialSheet";
import { RecordsSheet } from "./RecordsSheet";
import { explainText, recordRows, requirementRows, seriesKeys, shortDate, STAT_KEYS, STAT_NAMES, statDelta, statSeries, titleTiles, trialAttachDay, type StatKey } from "./statsView";
import { RecordList, TitleGrid } from "./StatsRows";
import styles from "./StatsScreen.module.css";
import { TitlesSheet } from "./TitlesSheet";

export interface StatsScreenProps {
  todayKey: DateKey;
  /** The quest log panel, rendered last when provided. */
  questLog?: ReactNode;
}

/** Rows on the tab before "View all" / "All titles". */
export const RECORDS_SHOWN = 5;
export const TITLES_SHOWN = 8;

const group = (n: number): string => n.toLocaleString("en-US");
const isStatKey = (s: string): s is StatKey => (STAT_KEYS as readonly string[]).includes(s);

function StatsSkeleton() {
  return (
    <div className="ot-stack">
      <Skeleton height={56} />
      <Skeleton lines={4} />
      <div className="ot-stat-grid">
        <Skeleton height={120} />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </div>
      <Skeleton lines={5} />
    </div>
  );
}

export function StatsScreen({ todayKey, questLog }: StatsScreenProps) {
  const { state, patchSettings } = useAppData();
  const { days, program, settings, historyComplete } = state;
  const progress = useGame(todayKey);
  const { sheet, openSheet, closeSheet, navigate } = useHashRoute();
  const toast = useToast();
  const units = settings.units;
  const featured = settings.game.title ?? null;

  const series = useMemo(() => statSeries({ days, todayKey, results: progress.days, settings: settings.game, metaFor }), [days, todayKey, progress, settings.game]);
  const records = useMemo(() => recordRows(progress, days, units, todayKey), [progress, days, units, todayKey]);
  const tiles = useMemo(() => {
    const all = titleTiles(progress, featured);
    return [...all.filter((t) => t.unlocked), ...all.filter((t) => !t.unlocked)];
  }, [progress, featured]);

  const feature = useCallback((title: string) => {
    patchSettings({ game: { title } });
    toast.show({ tag: "TITLE", text: `${title} featured.` });
  }, [patchSettings, toast]);

  if (!historyComplete) return <StatsSkeleton />;

  const { level, levelProgress: lp, nextRank, trial } = progress;
  const rows = requirementRows(progress);
  const trialReady = nextRank.trialAvailable && trial !== null;
  const explainKey = sheet?.startsWith("explain-") ? sheet.slice("explain-".length) : "";
  const explaining = isStatKey(explainKey) ? explainKey : null;
  const labels = seriesKeys(todayKey).map(shortDate);
  // Today's quest, once issued, no longer takes the trial: the next day can.
  const todayIssued = days[todayKey]?.quest !== undefined;

  return (
    <>
      <div className={styles.head}>
        <h1 className="ot-title ot-screen-title">Stats</h1>
      </div>

      <Panel aria-label="Status">
        <div className={styles.identity}>
          <RankBadge rank={progress.rank} size="lg" />
          <div className={styles.who}>
            <div className="ot-heading">{settings.profile.name ?? "Guest"}</div>
            {featured ? <div className="ot-small ot-ink-2">{featured}</div> : null}
          </div>
        </div>
        <div className={cx("ot-numeral", styles.level)}>Lv {level} · {group(lp.into)} / {group(lp.needed)} XP</div>
        <ProgressBar kind="xp" size="lg" value={lp.fraction} label={`Level ${level} progress`} />
        {nextRank.rank ? (
          <div className={styles.requirements}>
            <div className="ot-tag ot-ink-2">Rank {nextRank.rank} requirements</div>
            {rows.map((r) => (
              <div key={r.key} className={r.locked ? styles.lockedRow : undefined}>
                <ObjectiveRow label={r.label} state={r.state} {...(r.sublabel ? { sublabel: r.sublabel } : {})} />
                {r.locked ? <Icon name="lock" size={16} className={styles.lock} /> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className={`ot-small ot-ink-2 ${styles.top}`}>Top rank.</p>
        )}
        {trialReady ? (
          <div className={styles.action}>
            <Button variant="primary" full onClick={() => openSheet("trial")}>Begin Rank Trial</Button>
          </div>
        ) : null}
      </Panel>

      <section className="ot-stat-grid" aria-label="Stats">
        {STAT_KEYS.map((key) => (
          <StatTile key={key} name={STAT_NAMES[key]} value={progress.stats[key].value} series={series[key]} delta={statDelta(progress.stats[key])} onClick={() => openSheet(`explain-${key}`)} />
        ))}
      </section>

      <Panel title="Records" aria-label="Records">
        {records.length === 0 ? (
          <EmptyState tag="RECORDS" title="No records yet" body="Your first logged set becomes your first record." action={{ label: "Back to quest", variant: "secondary", onClick: () => navigate("/quest") }} />
        ) : (
          <>
            <RecordList rows={records.slice(0, RECORDS_SHOWN)} label="Latest records" />
            {records.length > RECORDS_SHOWN ? <Button variant="ghost" full className={styles.more} onClick={() => openSheet("records")}>View all</Button> : null}
          </>
        )}
      </Panel>

      <Panel title={<>Titles <span className="ot-numeral">{progress.titles.unlocked.length}/{progress.titles.total}</span></>} aria-label="Titles">
        <TitleGrid tiles={tiles.slice(0, TITLES_SHOWN)} label="Titles" onFeature={feature} />
        {tiles.length > TITLES_SHOWN ? <Button variant="ghost" full className={styles.more} onClick={() => openSheet("titles")}>All titles</Button> : null}
      </Panel>

      {questLog ?? null}

      {sheet === "trial" && trial ? <RankTrialSheet trial={trial} attachKey={trialAttachDay(program, trial, todayIssued ? addDays(todayKey, 1) : todayKey)} onClose={closeSheet} /> : null}
      {explaining ? <ExplainSheet explain={explainText(explaining, progress)} points={series[explaining].map((value, i) => ({ label: labels[i] ?? "", value }))} onClose={closeSheet} /> : null}
      {sheet === "records" ? <RecordsSheet rows={records} onClose={closeSheet} /> : null}
      {sheet === "titles" ? <TitlesSheet tiles={tiles} unlocked={progress.titles.unlocked.length} total={progress.titles.total} onFeature={feature} onClose={closeSheet} /> : null}
    </>
  );
}
