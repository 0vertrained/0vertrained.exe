// src/RaceResult.jsx
// Marking a logged run as a race: the line under a run that says so, and the
// sheet that takes the distance, finish time and name. With a race plan,
// the sheet then offers to set training paces from the result.
import { useState } from "react";
import { Seg, Sheet } from "./ui/ledger";
import { formatDuration, formatPace, parseDuration } from "./runPaces";
import { RESULT_DISTANCES, normalizeRace, paceUpdateFor, raceLabel, racePace } from "./raceResults";

const DISTANCE_OPTIONS = RESULT_DISTANCES.map((id) => ({ value: id, label: id === "half" ? "Half" : raceLabel(id) }));

/** The distance a run most likely was, from the plan or its miles. */
export function likelyRaceDistance({ planned = null, spec = null, miles = null } = {}) {
  if (planned?.planRole === "race" && RESULT_DISTANCES.includes(spec?.distance)) return spec.distance;
  if (planned?.planRole === "benchmark") return "5k";
  const value = Number.parseFloat(miles);
  if (value >= 20) return "marathon";
  if (value >= 10) return "half";
  if (value >= 5) return "10k";
  return "5k";
}

function zonesLine(zones) {
  if (!zones) return "";
  return `easy ${formatPace(zones.easy.fast)}–${formatPace(zones.easy.slow)}/mi, threshold ${formatPace(zones.threshold)}/mi`;
}

/** Under a logged run: the race it was, or a way to say it was one. */
export function RaceLine({ race, isBest = false, onOpen }) {
  if (!race) {
    return <button type="button" className="btn btn-g btn-sm" onClick={onOpen} style={{ alignSelf: "flex-start", paddingLeft: 0 }}>Log as a race</button>;
  }
  return (
    <div className="row" style={{ minHeight: 48 }}>
      <span className="kv grow">
        <span className="t-bs clip">{race.name || `${raceLabel(race.distance)} race`}</span>
        <span className="n-s c2">{raceLabel(race.distance)} in {formatDuration(race.seconds)} · {formatPace(racePace(race))}/mi</span>
      </span>
      {isBest && <span className="tag tag-e">PR</span>}
      <button type="button" className="btn btn-s btn-sm" onClick={onOpen}>Edit</button>
    </div>
  );
}

/**
 * The race sheet. `race` is the run's current result, if any; onSave gets
 * the result (or null to take it off); onUsePaces gets a benchmark.
 */
export function RaceSheet({ open, race = null, defaultDistance = "5k", dateKey, spec = null, onSave, onUsePaces, onClose }) {
  const [distance, setDistance] = useState(race?.distance || defaultDistance);
  const [time, setTime] = useState(race ? formatDuration(race.seconds) : "");
  const [name, setName] = useState(race?.name || "");
  const [problem, setProblem] = useState("");
  const [offer, setOffer] = useState(null);
  const [lastKey, setLastKey] = useState(open);
  // Each opening starts from the run's own result.
  if (open !== lastKey) {
    setLastKey(open);
    if (open) {
      setDistance(race?.distance || defaultDistance);
      setTime(race ? formatDuration(race.seconds) : "");
      setName(race?.name || "");
      setProblem("");
      setOffer(null);
    }
  }

  const save = () => {
    const result = normalizeRace({ distance, seconds: parseDuration(time), name });
    if (!result) {
      setProblem("Enter the finish time as minutes and seconds, like 24:10, or with hours, like 1:52:30.");
      return;
    }
    onSave(result);
    const update = paceUpdateFor({ result, dateKey, spec });
    if (update && onUsePaces) setOffer(update);
    else onClose();
  };

  return (
    <Sheet open={open} title={offer ? "Update your training paces?" : race ? "Race result" : "Log as a race"} onClose={onClose}>
      {open && !offer && (
        <>
          <Seg label="Distance" options={DISTANCE_OPTIONS} value={distance} onChange={setDistance} />
          <label className="field">
            <span className="lbl">Finish time</span>
            <input className="input n" type="text" inputMode="numeric" autoComplete="off" placeholder={distance === "5k" || distance === "10k" ? "24:10" : "1:52:30"} value={time} onChange={(event) => { setTime(event.target.value); setProblem(""); }} aria-invalid={problem ? "true" : undefined} aria-describedby={problem ? "race-time-problem" : undefined} />
          </label>
          {problem && <p id="race-time-problem" className="err" role="alert">{problem}</p>}
          <label className="field">
            <span className="lbl">Race name (optional)</span>
            <input className="input" type="text" autoComplete="off" placeholder="Turkey Trot" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="button" className="btn btn-p btn-b" onClick={save}>Save race</button>
          {race && <button type="button" className="btn btn-s btn-b" onClick={() => { onSave(null); onClose(); }}>It wasn’t a race</button>}
        </>
      )}
      {open && offer && (
        <>
          <p className="t-b">
            A {raceLabel(offer.benchmark.distance)} in {formatDuration(offer.benchmark.seconds)} puts your training at {zonesLine(offer.next)}.
            {offer.current ? ` Your plan uses ${zonesLine(offer.current)} now.` : " Your plan has no paces yet; it goes by effort."}
          </p>
          <p className="t-s c2">Every run left in the plan, and the ones on your watch, take the new paces.</p>
          <button type="button" className="btn btn-p btn-b" onClick={() => { onUsePaces(offer.benchmark); onClose(); }}>Use these paces</button>
          <button type="button" className="btn btn-s btn-b" onClick={onClose}>Keep my paces</button>
        </>
      )}
    </Sheet>
  );
}
