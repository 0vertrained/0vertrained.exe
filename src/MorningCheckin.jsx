import { useState } from "react";
import { CHECKIN_ROWS, readCheckin, selectedOption, checkinSummaryLine } from "./checkinMorning";
import { Fold, Icon, Seg } from "./ui/ledger";

const sentence = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
const rowLabel = (row) => row.label.charAt(0) + row.label.slice(1).toLowerCase();

// The one place the check-in is entered: four rows of three choices on the
// sleepQuality / soreness / stress / energy fields of the day being logged.
// It sits above Today's call until it's answered, so you rate how you feel
// before the number tells you, then folds to one line that is written in.
// Never required: the call resolves without it.
export function MorningCheckin({ body = {}, updateToday }) {
  const [editing, setEditing] = useState(false);
  if (typeof updateToday !== "function") return null;
  const checkin = readCheckin(body);
  const open = !checkin.complete || editing;

  return (
    <div data-section="morning-checkin" style={{ display: "flex", flexDirection: "column" }}>
      <Fold open={open} id="checkin-rows">
        <section aria-labelledby="checkin-title" style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 4 }}>
          <div className="sec">
            <h2 id="checkin-title" className="t-ss">How do you feel?</h2>
            <span className="t-s c2">{checkin.complete ? `${checkin.answered} of ${checkin.total} answered` : "Before you see the score"}</span>
          </div>
          {CHECKIN_ROWS.map((row) => (
            <div key={row.field} className="ci">
              <span className="t-ss" aria-hidden="true">{rowLabel(row)}</span>
              <Seg
                label={rowLabel(row)}
                options={row.options.map((opt) => ({ value: opt.value, label: opt.text }))}
                value={selectedOption(row, body?.[row.field])?.value}
                onChange={(value) => updateToday(`body.${row.field}`, String(value))}
              />
            </div>
          ))}
          {checkin.complete && (
            <button type="button" className="btn btn-s btn-sm" style={{ alignSelf: "flex-end" }} onClick={() => setEditing(false)}>Done</button>
          )}
        </section>
      </Fold>
      {!open && (
        <div className="mo-write" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
          <Icon name="check" size="s" />
          <p className="t-s grow">{sentence(checkinSummaryLine(body))}</p>
          <button type="button" className="btn btn-g btn-sm" aria-label="Edit check-in" aria-expanded="false" aria-controls="checkin-rows" onClick={() => setEditing(true)}>Edit</button>
        </div>
      )}
    </div>
  );
}

export default MorningCheckin;
