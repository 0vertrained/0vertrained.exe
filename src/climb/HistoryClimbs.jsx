import { useState } from "react";
import { healthRoutesAvailable, listHealthRoutes } from "./hardware";

// Route permission is requested only after the athlete asks for it. Check the
// store on each retry because a workout's route can arrive after its summary.
export function HistoryClimbs({ owner, dateKey, onRaceClimb }) {
  const [routes, setRoutes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!owner || !onRaceClimb || !healthRoutesAvailable()) return null;
  const check = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const all = await listHealthRoutes(owner, dateKey);
      const byId = new Map();
      for (const route of all) {
        if (route?.date === dateKey && typeof route.id === "string" && route.id) byId.set(route.id,route);
      }
      setRoutes([...byId.values()]);
    } catch (e) { setError(e.message || "Could not read today's workout routes."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Outdoor routes for Race the Climb">
    <h3 className="t-h">Race the Climb</h3>
    {routes?.length > 0 && <ul className="rows">{routes.map(run =>
      <li key={run.id} className="row"><span className="grow t-s">{run.name || "Outdoor workout"}{Number.isFinite(run.meters) && run.meters > 0 ? " · " + (run.meters / 1000).toFixed(2) + " km" : ""}</span>
        <button type="button" className="btn btn-s btn-sm" onClick={() => onRaceClimb({ id: run.id, date: dateKey, name: run.name || "Outdoor workout", owner })}>Race this climb</button></li>)}</ul>}
    {routes && !routes.length && <p role="status" className="t-s c2">Apple Health has no readable outdoor route for this day.</p>}
    {error && <p role="alert" className="err">{error}</p>}
    {(!routes?.length || error) && <button type="button" className="btn btn-s btn-sm" disabled={busy} onClick={check}>
      {busy ? "Checking Apple Health…" : routes || error ? "Check routes again" : "Find this day’s outdoor routes"}</button>}
  </section>;
}
