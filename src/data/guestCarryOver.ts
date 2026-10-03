// Carrying guest data into the account the athlete just signed in to. Both
// sources are loaded, then only what the account lacks goes up: days for
// dates it has none for (in chunks of 50), the program when it has none,
// and the guest's settings only when the account's are not yet onboarded
// (units, bodyweight, session, game start and title; game.high is unioned
// so a high-water mark never drops). Then the guest store is cleared. It is
// idempotent: run again after a failure midway, it uploads only what is
// still missing. The demo character is never uploaded.
//
// Two localStorage flags support the flow: "upload pending" is set before
// the athlete goes off to sign in and read when they come back; "demo"
// marks guest data that was seeded from the demo.

import { compareKeys, type DateKey } from "../domain/dates";
import { rankIndex } from "../domain/game/ranks";
import type { GameHigh, Rank } from "../domain/game/types";
import type { DataSource } from "./DataSource";
import { patchSettings, type DeepPartial, type SettingsV2 } from "./settings";

export {
  GUEST_UPLOAD_PENDING_KEY,
  GUEST_DEMO_KEY,
  markGuestUploadPending,
  isGuestUploadPending,
  clearGuestUploadPending,
  markDemo,
  isDemo,
  clearDemo,
} from "./guestFlags";
import { clearGuestUploadPending, isDemo } from "./guestFlags";

/** Days saved concurrently per round. */
export const UPLOAD_CHUNK = 50;

/** The union of two high-water marks: the higher rank, every trial (earliest date per rank), every achievement. */
export function unionHigh(a: Partial<GameHigh> | undefined, b: Partial<GameHigh> | undefined): Partial<GameHigh> | undefined {
  if (!a || !b) return a ?? b;
  const out: Partial<GameHigh> = {};
  const rank = [a.rank, b.rank].filter((r): r is Rank => r !== undefined).sort((x, y) => rankIndex(y) - rankIndex(x))[0];
  if (rank !== undefined) out.rank = rank;
  if (a.trialsPassed || b.trialsPassed) {
    const byRank = new Map<Rank, { rank: Rank; date: DateKey }>();
    for (const trial of [...(a.trialsPassed ?? []), ...(b.trialsPassed ?? [])]) {
      const known = byRank.get(trial.rank);
      if (!known || compareKeys(trial.date, known.date) < 0) byRank.set(trial.rank, trial);
    }
    out.trialsPassed = [...byRank.values()];
  }
  if (a.achievements || b.achievements) out.achievements = [...new Set([...(a.achievements ?? []), ...(b.achievements ?? [])])];
  return out;
}

/**
 * The account's settings with the guest's carried in: units, bodyweight,
 * session, game start and title come from the guest; onboarded once either
 * side is; game.high is the union. The profile and the rest stay the
 * account's.
 */
export function carrySettings(account: SettingsV2, guest: SettingsV2): SettingsV2 {
  const game: DeepPartial<SettingsV2["game"]> = {};
  if (guest.game.startedOn !== undefined) game.startedOn = guest.game.startedOn;
  if (guest.game.title !== undefined) game.title = guest.game.title;
  const high = unionHigh(account.game.high, guest.game.high);
  if (high) game.high = high;
  const patch: DeepPartial<SettingsV2> = { units: guest.units, onboarded: account.onboarded || guest.onboarded, session: { ...guest.session }, game };
  if (guest.bodyweightKg !== undefined) patch.bodyweightKg = guest.bodyweightKg;
  return patchSettings(account, patch);
}

export interface UploadProgress {
  /** Days uploaded so far, of `total` the account lacked. */
  done: number;
  total: number;
}

export interface UploadGuestDataOptions {
  local: DataSource;
  remote: DataSource;
  /** Where the flags live; default window.localStorage. */
  storage?: Storage;
  onProgress?: (progress: UploadProgress) => void;
}

export interface GuestUploadResult {
  uploadedDays: number;
  /** True when the account already held data (a day, a program or onboarded settings), so the guest copy was merged into it rather than becoming it. */
  keptRemote: boolean;
  /** Set when nothing was uploaded on purpose. */
  skipped?: "demo";
}

/**
 * Uploads what the account lacks (see the file header), clears the guest
 * store and the pending flag, and reports what happened. Rejects on the
 * first failed write, leaving the guest store intact for another run.
 * Demo data is skipped outright, guest store and flags untouched.
 */
export async function uploadGuestData(options: UploadGuestDataOptions): Promise<GuestUploadResult> {
  const { local, remote, onProgress } = options;
  const storage = options.storage ?? window.localStorage;
  if (isDemo(storage)) return { uploadedDays: 0, keptRemote: true, skipped: "demo" };

  const [guest, account] = await Promise.all([local.load(), remote.load()]);
  const keptRemote = Object.keys(account.days).length > 0 || account.program !== null || account.settings.onboarded;
  const missing = Object.keys(guest.days).filter((key) => !(key in account.days)).sort(compareKeys);
  let done = 0;
  onProgress?.({ done, total: missing.length });
  for (let i = 0; i < missing.length; i += UPLOAD_CHUNK) {
    const chunk = missing.slice(i, i + UPLOAD_CHUNK);
    await Promise.all(chunk.map((key) => {
      const day = guest.days[key];
      return day ? remote.saveDay(key, day) : Promise.resolve();
    }));
    done += chunk.length;
    onProgress?.({ done, total: missing.length });
  }
  if (guest.program && !account.program) await remote.saveProgram(guest.program);
  if (!account.settings.onboarded) await remote.saveSettings(carrySettings(account.settings, guest.settings));
  await local.clear();
  clearGuestUploadPending(storage);
  return { uploadedDays: missing.length, keptRemote };
}
