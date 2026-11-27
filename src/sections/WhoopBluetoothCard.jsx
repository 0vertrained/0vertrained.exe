import { useEffect, useRef, useState } from "react";
import { getWhoopBluetooth, subscribeWhoopBluetooth } from "../whoop/bluetooth";
import { WhoopReadingStatus } from "../whoop/WhoopReadingStatus";
import { WhoopStoredReadings } from "../whoop/WhoopStoredReadings";
import { useScreenWakeLock } from "../sessionDevice";

const FRESH_MS = 15_000;
const INITIAL = { status: "idle", devices: [], device: null };
const column = { display: "flex", flexDirection: "column", gap: 8, padding: 12 };

function freshSample(sample) {
  const age = Date.now() - sample?.timestamp;
  return Number.isFinite(sample?.bpm) && sample.bpm > 0 && age >= 0 && age < FRESH_MS ? sample : null;
}

function statusText(state, scanned) {
  const name = state.device?.name || "WHOOP strap";
  switch (state.status) {
    case "scanning": return "Searching nearby…";
    case "connecting": return `Connecting to ${name}…`;
    case "connected": return `Connected to ${name}`;
    case "disconnected": return state.autoReconnect ? "Waiting for your saved strap" : "Disconnected";
    case "unavailable": return "Bluetooth unavailable";
    case "error": return "Connection issue";
    default:
      if (scanned && !state.devices?.length) return "No straps found. Keep the strap near your iPhone and try again while the light flashes blue.";
      if (state.savedDevice && state.autoReconnect === false) return "Automatic reconnect paused";
      return state.savedDevice ? `Saved strap · ${state.savedDevice.name}` : "Ready to pair";
  }
}

export function WhoopBluetoothCard() {
  const [state, setState] = useState(INITIAL);
  const [sample, setSample] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState(false);
  const [viewHistory, setViewHistory] = useState(false);
  const [lastLiveAt, setLastLiveAt] = useState(null);
  const revision = useRef(0);
  const shownDevice = useRef(null);
  const connected = state.status === "connected";
  const connecting = state.status === "connecting";
  const scanning = state.status === "scanning";
  const devices = state.devices || [];
  const plugin = getWhoopBluetooth();
  const history = state.history;
  const syncing = history?.status === "syncing";
  useScreenWakeLock(syncing);

  function applyState(next) {
    if (!next?.status) return;
    revision.current += 1;
    setState(next);
    const id = next.device?.id ?? next.savedDevice?.id ?? null;
    if (id !== shownDevice.current) {
      shownDevice.current = id;
      setLastLiveAt(null);
      setSample(null);
    }
    if (next.status !== "connected") setSample(null);
    else if (freshSample(next.lastSample)) {
      setSample(previous => previous?.timestamp > next.lastSample.timestamp ? previous : next.lastSample);
    }
  }

  useEffect(() => subscribeWhoopBluetooth({
    onState: applyState,
    onSample: reading => {
      const fresh = freshSample(reading);
      if (fresh) setLastLiveAt(fresh.timestamp);
      setSample(fresh);
    },
    onError: () => setError("Couldn’t read the strap connection. Reopen Integrations to try again."),
  }), []);

  // A connected strap can stop producing measurements when removed. Expire
  // the last beat even if Bluetooth never reports a disconnection.
  useEffect(() => {
    if (!sample) return;
    const age = Date.now() - sample.timestamp;
    const delay = Math.max(0, FRESH_MS - age);
    const timer = setTimeout(() => setSample(current => current === sample ? null : current), delay);
    return () => clearTimeout(timer);
  }, [sample]);

  async function action(method, options) {
    const plugin = getWhoopBluetooth();
    if (!plugin || busy) return;
    setBusy(true);
    setError("");
    if (method === "scan") setScanned(true);
    else if (method === "stopScan" || options?.forget) setScanned(false);
    const before = revision.current;
    try {
      const result = await plugin[method](options);
      if (revision.current === before) applyState(result);
    } catch (cause) {
      if (method === "scan") setScanned(false);
      setError(cause?.message || "Couldn’t reach the strap. Keep it nearby and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="int-whoop-strap" style={column}>
      <h2 id="int-whoop-strap" className="t-h">WHOOP Bluetooth</h2>
      <p className="t-s c2">Connect your WHOOP 4.0 directly to this iPhone for heart rate{history ? " and stored readings" : ""} without a WHOOP membership.</p>
      {state.savedDevice && state.autoReconnect === true &&
        <p className="t-s c2">Your iPhone reconnects to this strap when you open 0VERTRAINED. Disconnect strap pauses automatic reconnect.</p>}
      {state.savedDevice && state.autoReconnect === false &&
        <p className="t-s c2">Choose Reconnect strap to resume automatic reconnect.</p>}
      {!connected && !connecting && !state.savedDevice && (
        <p className="t-s c2">Take the strap off your wrist and tap the sensor until it flashes blue. Choose Find strap, then select yours.</p>
      )}
      <p role="status" className={connected ? "t-ss good" : "t-ss c2"}>{statusText(state, scanned)}</p>
      {connected && (
        <p className="t-s" aria-label="Live heart rate">
          {sample ? <><span className="n-lg">{sample.bpm}</span> bpm</> : "Waiting for a fresh reading…"}
        </p>
      )}
      {(state.device || state.savedDevice) && <WhoopReadingStatus batteryPercent={state.batteryPercent}
        batteryAt={state.batteryAt} lastReadingAt={Math.max(lastLiveAt || 0, state.lastReadingAt || 0, state.lastSample?.timestamp || 0)} />}
      {state.message && <p className="t-s c2">{state.message}</p>}
      {error && <p role="alert" className="t-s err">{error}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {connecting || connected ? (
          <button type="button" className="btn btn-s btn-sm" disabled={busy} onClick={() => action("disconnect")}>
            {connecting ? "Cancel connection" : "Disconnect strap"}
          </button>
        ) : scanning ? (
          <button type="button" className="btn btn-s btn-sm" disabled={busy} onClick={() => action("stopScan")}>Stop scan</button>
        ) : (
          <>
            {state.savedDevice && <button type="button" className="btn btn-p btn-sm" disabled={busy} onClick={() => action("connect", { id: state.savedDevice.id })}>Reconnect strap</button>}
            {state.savedDevice && state.autoReconnect === true && <button type="button" className="btn btn-s btn-sm" disabled={busy} onClick={() => action("disconnect")}>Pause automatic reconnect</button>}
            <button type="button" className={state.savedDevice ? "btn btn-s btn-sm" : "btn btn-p btn-sm"} disabled={busy} onClick={() => action("scan")}>Find strap</button>
            {state.savedDevice && <button type="button" className="btn btn-g btn-sm" disabled={busy} onClick={() => action("disconnect", { forget: true })}>Forget strap</button>}
          </>
        )}
      </div>
      {!connected && !connecting && devices.length > 0 && (
        <ul className="rows" aria-label="Nearby straps">
          {devices.map(device => (
            <li key={device.id} className="row" style={{ minHeight: 48, gap: 8 }}>
              <span className="t-bs grow">{device.name || "WHOOP strap"}</span>
              <button type="button" className="btn btn-s btn-sm" aria-label={`Connect to ${device.name || "WHOOP strap"}`} disabled={busy} onClick={() => action("connect", { id: device.id })}>Connect</button>
            </li>
          ))}
        </ul>
      )}
      {history && plugin?.readHistory && (
        <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h3 className="t-bs">Overnight and phone-free recordings</h3>
          <p className="t-s c2">{typeof state.autoReconnect === "boolean"
            ? "Open 0VERTRAINED with your strap nearby to import stored readings. You can use other screens while the app stays open."
            : "After wearing the strap away from your phone, bring it nearby and keep this screen open to sync."} Once this iPhone saves a block of readings, the strap can free that space.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-p btn-sm" disabled={busy || syncing || !state.historyAvailable}
              onClick={() => action("startHistorySync")}>{syncing ? "Syncing strap history…" : "Sync strap history"}</button>
            <button type="button" className="btn btn-s btn-sm" aria-expanded={viewHistory}
              onClick={() => setViewHistory(open => !open)}>{viewHistory ? "Hide stored readings" : "View stored readings"}</button>
          </div>
          {(!state.historyAvailable && !syncing) && <p className="t-s c2">{connected
            ? "Waiting for the strap’s history channel." : "Connect the strap to sync new readings."}</p>}
          {(syncing || history.message) && <p role="status" className="t-s c2">{history.message || "Receiving stored readings…"}
            {syncing && history.records > 0 && ` · ${history.records.toLocaleString()} records`}</p>}
          {history.lastSyncAt > 0 && <p className="t-s c2">Last completed sync · {new Date(history.lastSyncAt).toLocaleString()}</p>}
          {history.unsupported > 0 && <p className="t-s c2">{history.unsupported.toLocaleString()} records use a layout this version can’t display yet.</p>}
          {viewHistory && <WhoopStoredReadings bridge={plugin} history={history} />}
        </div>
      )}
    </section>
  );
}
