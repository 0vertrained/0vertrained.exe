// src/MoveDay.jsx
// Train → This week → Move a day: swap two days' training for this week
// only. The first tap picks the day to move, the second the day it swaps
// with. A day with training already logged stays put, and a past day can
// only trade with today or a day ahead, so a missed session can be made up
// but the past isn't rearranged. The program itself is never changed; the
// swap is kept for this week (./weekMoves).
import { useState } from "react";
import { Icon, Sheet } from "./ui/ledger";

// Why a day can't be picked, or null when it can.
function blockedReason(day, from) {
  if (day.started || day.done) return "Training already logged";
  if (day.moveLock) return day.moveLock;
  if (from && day.dayName === from.dayName) return "The day you picked";
  if (from && day.when === "past" && from.when === "past") return "Pick today or a day ahead";
  return null;
}

function DayButton({ day, from, onPick }) {
  const reason = blockedReason(day, from);
  return (
    <li>
      <button
        type="button"
        className="row"
        aria-disabled={reason ? true : undefined}
        onClick={() => { if (!reason) onPick(day); }}
        style={{ minHeight: 56, opacity: reason ? 0.6 : 1 }}
      >
        <span className={day.when === "today" ? "n-s" : "n-s c2"} style={{ width: 52, flex: "none" }}>{day.label}</span>
        <span className="kv grow">
          <span className="t-bs clip">{day.title}</span>
          <span className="t-s c2">{reason || day.detail}</span>
        </span>
        {!reason && <Icon name="next" size="s" className="c2" />}
      </button>
    </li>
  );
}

/**
 * The sheet. `week` is Train's week (buildTrainWeek); onSwap(first, second)
 * gets two day names; onReset puts the week back, or is null when nothing
 * has moved.
 */
export function MoveDaySheet({ open, week, onSwap, onReset = null, onClose }) {
  const [from, setFrom] = useState(null);
  const close = () => { setFrom(null); onClose(); };
  return (
    <Sheet open={open} title={from ? `Swap ${from.dayName} with` : "Move a day this week"} onClose={close}>
      {open && (
        <>
          <p className="t-s c2">
            {from
              ? `${from.title} moves to the day you pick, and that day’s training moves to ${from.dayName}. Only this week changes.`
              : "Pick the day whose training you want to move. It swaps with the day you pick next. Your program stays as it is."}
          </p>
          <ol className="rows" aria-label={from ? `Days to swap with ${from.dayName}` : "This week’s days"}>
            {week.map((day) => (
              <DayButton
                key={day.dateKey}
                day={day}
                from={from}
                onPick={(picked) => {
                  if (!from) { setFrom(picked); return; }
                  onSwap(from.dayName, picked.dayName);
                  close();
                }}
              />
            ))}
          </ol>
          {from && <button type="button" className="btn btn-s btn-b" onClick={() => setFrom(null)}>Pick a different day</button>}
          {!from && onReset && <button type="button" className="btn btn-s btn-b" onClick={() => { onReset(); close(); }}>Put this week back as planned</button>}
        </>
      )}
    </Sheet>
  );
}

export default MoveDaySheet;
