import { nativePlugin } from "../native";

// A web build can update while the installed native shell still predates FTMS.
const belt = () => nativePlugin("OTClimb");
const health = () => nativePlugin("OTRuns");
const offline = () => ({ status: "unavailable", devices: [], fresh: false, autoIncline: false });
export const climbHardwareAvailable = () => typeof belt()?.scan === "function";
export const healthRoutesAvailable = () => typeof health()?.climbRoute === "function";

export async function getTreadmill() {
  return climbHardwareAvailable() ? belt().status() : offline();
}
export async function scanTreadmills(mode) {
  if (!climbHardwareAvailable()) return offline();
  return mode === "peloton" ? belt().scan({ mode: "peloton" }) : belt().scan();
}
export async function connectTreadmill(id) {
  if (!climbHardwareAvailable()) throw new Error("Open the updated iPhone app to connect a treadmill.");
  return belt().connect({ id });
}
export async function disconnectTreadmill({ forget = false } = {}) {
  if (!climbHardwareAvailable()) return offline();
  return forget ? belt().disconnect({ forget: true }) : belt().disconnect();
}
export async function subscribeTreadmill(callback) {
  if (!climbHardwareAvailable()) return () => {};
  const handle = await belt().addListener("treadmillState", callback);
  return () => { handle.remove().catch(() => {}); };
}
export async function listHealthRoutes(owner, nearDate) {
  if (!healthRoutesAvailable()) throw new Error("Open the updated iPhone app to import an Apple Health route.");
  return (await health().climbRouteList({ owner, ...(nearDate ? { nearDate } : {}) })).runs || [];
}
export async function importHealthRoute(id, owner) {
  if (!healthRoutesAvailable()) throw new Error("Apple Health routes require the updated iPhone app.");
  return (await health().climbRoute({ id, owner })).gpx;
}

// Native code verifies the model/firmware, confirmation, current workout token,
// fresh feedback and user cap independently of the downloaded web interface.
export async function armTreadmill({ owner, recordingId, capPercent, confirmed }) {
  if (!climbHardwareAvailable()) throw new Error("Treadmill control is unavailable.");
  return belt().arm({ owner, recordingId, capPercent, confirmed });
}
export async function requestTreadmillIncline({ owner, recordingId, armToken, grade, sequence }) {
  if (!climbHardwareAvailable()) throw new Error("Treadmill control is unavailable.");
  return belt().requestIncline({ owner, recordingId, armToken, grade, sequence });
}
export async function disarmTreadmill() {
  if (typeof belt()?.disarm === "function") return belt().disarm();
  return offline();
}
