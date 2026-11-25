import { useState } from "react";
import { useTheme } from "./theme";
import { CHECKIN_ROWS, readCheckin, selectedOption, checkinSummaryLine } from "./checkinMorning";

// The one place the check-in is entered: four tap rows on the sleepQuality /
// soreness / stress / energy fields of the day being logged. It sits above
// Today's call until it's answered, so you rate how you feel before the
// number tells you, then folds to one line. Never required: the call
// resolves without it.
export function MorningCheckin({ body = {}, updateToday }) {
  const { C, S } = useTheme();
  const [editing, setEditing] = useState(false);
  if (typeof updateToday !== "function") return null;
  const checkin = readCheckin(body);
  const open = !checkin.complete || editing;
  const tapBtn = (selected) => ({
    fontFamily: C.monoFamily, fontSize: 12, letterSpacing: "0.04em",
    minWidth: 64, minHeight: 40, padding: "6px 12px", cursor: "pointer", borderRadius: 0,
    border: `1px solid ${selected ? C.text : C.lineBright}`,
    background: selected ? C.text : "transparent",
    color: selected ? C.panel : C.textDim,
  });

  return (
    <section data-section="morning-checkin" style={S.block} aria-label="Check-in">
      <div style={S.blockHead}>
        <span style={S.blockTitle}>{"> "}Check-in</span>
        <span style={S.blockStat}>{checkin.answered}/{checkin.total}</span>
      </div>
      {open ? (
        <div>
          {CHECKIN_ROWS.map((row) => {
            const sel = selectedOption(row, body?.[row.field]);
            return (
              <div key={row.field} role="group" aria-label={row.label.toLowerCase()} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "4px 0" }}>
                <span style={{ fontFamily: C.monoFamily, fontSize: 11, letterSpacing: "0.14em", color: C.textDim, width: 66 }}>{row.label}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {row.options.map((opt) => (
                    <button key={opt.value} type="button" style={tapBtn(sel?.value === opt.value)}
                      aria-pressed={sel?.value === opt.value}
                      onClick={() => updateToday(`body.${row.field}`, String(opt.value))}>
                      {opt.text}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {checkin.complete && (
            <button type="button" onClick={() => setEditing(false)} style={{ ...S.smallBtn, width: "100%", marginTop: 8 }}>Done</button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontFamily: C.monoFamily, fontSize: 12, color: C.textDim, lineHeight: 1.45 }}>{checkinSummaryLine(body)}</span>
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit check-in" style={{ ...S.smallBtn, flexShrink: 0 }}>Edit</button>
        </div>
      )}
    </section>
  );
}

export default MorningCheckin;
