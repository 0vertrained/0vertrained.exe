// A provider's status endpoint can rotate OAuth tokens. Share those reads across
// Settings, dashboards and foreground sync, and finish pending writes before unlinking.
import { supabase } from "../supabaseClient";

const MINUTE = 60_000;
const FRESH_FOR = 15 * MINUTE;
const DAY = 24 * 60 * MINUTE;

export async function currentCloudSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id && data.session.access_token ? data.session : null;
}

async function request(path, session, method = "GET") {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: { accept: "application/json", authorization: `Bearer ${session.access_token}` },
  });
  if (response.ok) return response.json();
  const body = await response.json().catch(() => ({}));
  const error = new Error(body?.error || `Request failed (${response.status})`);
  error.status = response.status;
  const retryAfter = response.headers?.get?.("Retry-After");
  const retryAt = Number(retryAfter) * 1000 || Date.parse(retryAfter) - Date.now();
  error.retryMs = Number.isFinite(retryAt) && retryAt > 0 ? retryAt : 0;
  throw error;
}

export function createCloudProvider(routes, invalidateRows = () => {}) {
  const owners = new Map();

  function stateFor(session) {
    const owner = session.user.id;
    if (!owners.has(owner)) owners.set(owner, { nextCheck: 0, revision: 0 });
    return owners.get(owner);
  }

  async function readStatus(session, maxAge = 0) {
    const state = stateFor(session);
    if (state.disconnect) {
      await state.disconnect;
      return readStatus(session, maxAge);
    }
    if (state.statusFlight) return state.statusFlight;
    if (maxAge && state.cached && Date.now() - state.checkedAt < maxAge) return state.cached;
    if (state.syncFlight) {
      await state.syncFlight.task.catch(() => {});
      return readStatus(session, maxAge);
    }
    const task = request(routes.status, session).then(status => {
      if (typeof status?.connected !== "boolean") throw new Error("Invalid provider status");
      if (state.statusFlight === task) {
        if (state.lastKnown && state.lastKnown.connected !== status.connected) state.nextCheck = 0;
        state.lastKnown = status;
        state.cached = status;
        state.checkedAt = Date.now();
      }
      return status;
    }).finally(() => { if (state.statusFlight === task) state.statusFlight = null; });
    state.statusFlight = task;
    return task;
  }

  async function sync(session, days) {
    const state = stateFor(session);
    const revision = state.revision;
    if (state.disconnect) throw new Error("Disconnect in progress");
    if (state.syncFlight) {
      if (state.syncFlight.days >= days) return state.syncFlight.task;
      await state.syncFlight.task.catch(() => {});
      if (state.revision !== revision) throw new Error("Connection changed");
      return sync(session, days);
    }
    const task = (async () => {
      if (state.statusFlight) await state.statusFlight.catch(() => {});
      if (state.revision !== revision) throw new Error("Connection changed");
      const result = await request(`${routes.sync}?days=${days}`, session, "POST");
      if (state.revision === revision) {
        state.cached = null;
        invalidateRows(session.user.id);
      }
      return result;
    })().finally(() => { if (state.syncFlight?.task === task) state.syncFlight = null; });
    state.syncFlight = { days, task };
    return task;
  }

  async function disconnect(session) {
    const state = stateFor(session);
    if (state.disconnect) return state.disconnect;
    state.revision++;
    state.cached = null;
    state.nextCheck = 0;
    const pending = [state.statusFlight, state.syncFlight?.task];
    const task = (async () => {
      await Promise.allSettled(pending);
      const result = await request(routes.disconnect, session, "POST");
      state.cached = { connected: false, syncStatus: "never" };
      state.lastKnown = state.cached;
      state.checkedAt = Date.now();
      state.retryIncomplete = false;
      invalidateRows(session.user.id);
      return result;
    })().finally(() => { state.disconnect = null; });
    state.disconnect = task;
    return task;
  }

  async function refreshOnOpen(session, signal) {
    const state = stateFor(session);
    if (signal?.aborted || state.disconnect || Date.now() < state.nextCheck) return;
    if (state.openFlight) {
      state.openFlight.signals.add(signal);
      return state.openFlight.task;
    }
    const signals = new Set([signal]);
    const revision = state.revision;
    const active = () => state.revision === revision && [...signals].some(s => !s?.aborted);
    const task = (async () => {
      let outcome = "retry";
      let delay = MINUTE;
      try {
        const status = await readStatus(session);
        if (!active()) return;
        const lastSync = Date.parse(status.lastSynced);
        const age = Date.now() - lastSync;
        if (!status.connected) {
          outcome = "disconnected";
          state.retryIncomplete = false;
        } else if (status.syncStatus === "refresh_pending") {
          outcome = "retry";
        } else if (status.syncStatus === "refresh_failed" || status.tokenEncryptionConfigured === false) {
          outcome = "needs_attention";
          delay = FRESH_FOR;
        } else if (!state.retryIncomplete && age >= 0 && age < FRESH_FOR) {
          invalidateRows(session.user.id);
          outcome = "fresh";
          delay = FRESH_FOR - age;
        } else {
          // Overlap two days for late sleep/recovery edits, catching up to a month after an absence.
          const days = Number.isFinite(age) ? Math.max(3, Math.min(30, Math.ceil(age / DAY) + 2)) : 14;
          const result = await sync(session, days);
          if (!active()) return;
          if (result?.ok === true && result.status !== "partial") {
            state.retryIncomplete = false;
            outcome = "synced";
            delay = FRESH_FOR;
          } else {
            state.retryIncomplete = result?.ok !== true;
            if (result?.stored > 0) outcome = "partial";
            if (result?.ok === true || result?.failures?.some(f => f.status === 429)) delay = FRESH_FOR;
          }
        }
      } catch (err) {
        if (!active()) return;
        // A restored-network signal may arrive seconds after transport failed.
        if (err instanceof TypeError || globalThis.navigator?.onLine === false) delay = 0;
        if (err.status === 404) outcome = "disconnected";
        if (err.status === 401 && err.message.includes("reconnect")) {
          outcome = "needs_attention";
          delay = FRESH_FOR;
        }
        if (err.status === 429) delay = Math.max(FRESH_FOR, err.retryMs || 0);
      }
      if (!active()) return;
      state.nextCheck = Date.now() + delay;
      return outcome;
    })().finally(() => { if (state.openFlight?.task === task) state.openFlight = null; });
    state.openFlight = { signals, task };
    return task;
  }

  return {
    refreshOnOpen,
    async status(maxAge = 0) {
      let session;
      try {
        session = await currentCloudSession();
        if (!session) return { connected: false, syncStatus: "unauthenticated" };
        return await readStatus(session, maxAge);
      } catch (error) {
        const known = session && stateFor(session).lastKnown;
        if (known && error.status !== 401 && error.status !== 403) return { ...known, syncStatus: "error" };
        return { connected: false, syncStatus: "error" };
      }
    },
    async syncNow(days) {
      try {
        const session = await currentCloudSession();
        if (!session) return { error: "Not authenticated" };
        return await sync(session, Number.isFinite(Number(days)) ? Math.max(1, Math.round(days)) : routes.defaultDays);
      } catch (err) { return { error: err.message }; }
    },
    async disconnect() {
      try {
        const session = await currentCloudSession();
        if (!session) return { error: "Not authenticated" };
        return await disconnect(session);
      } catch (err) { return { error: err.message }; }
    },
  };
}
