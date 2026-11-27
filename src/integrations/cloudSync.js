import { isDemoMode } from "../demoData";
import { ouraCloud } from "../oura/auth";
import { whoopCloud } from "../whoop/auth";
import { stravaCloud } from "../strava/auth";
import { currentCloudSession } from "./cloudProvider";

const providers = { oura: ouraCloud, whoop: whoopCloud, strava: stravaCloud };

export async function syncCloudOnOpen({ owner, signal }) {
  if (!owner || signal?.aborted || isDemoMode() || globalThis.navigator?.onLine === false) return {};
  const session = await currentCloudSession();
  if (session?.user.id !== owner || signal?.aborted) return {};
  const results = await Promise.all(Object.entries(providers).map(async ([name, provider]) => [
    name, await provider.refreshOnOpen(session, signal),
  ]));
  return signal?.aborted ? {} : Object.fromEntries(results.filter(([, outcome]) => outcome));
}
