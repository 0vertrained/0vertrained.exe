// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { loadRecoveryData } from "../recoveryLoad";
import { getOuraTokenStatus } from "../oura";
import { getWhoopTokenStatus } from "../whoop";
import { readWearableSnapshot, writeWearableSnapshot } from "../wearableSnapshotCache";
import { postServerSnapshot } from "../wearables/snapshot";

vi.mock("../oura", () => ({ getOuraTokenStatus: vi.fn(), loadOuraData: async () => ({}) }));
vi.mock("../whoop", () => ({ getWhoopTokenStatus: vi.fn(), loadWhoopData: async () => ({}) }));
vi.mock("../strava/dataLoading", () => ({ loadStravaActivities: async () => [], groupStravaByDate: () => ({}) }));
vi.mock("../wearables/snapshot", () => ({ postServerSnapshot: vi.fn(async () => ({ ok: true })) }));

afterEach(() => { localStorage.clear(); vi.clearAllMocks(); });

it.each([false, true])("keeps saved recovery on a failed open, including a last-known connection of %s", async connected => {
  writeWearableSnapshot("A", { connected: true, recovery: { score: 78 } }, 1000);
  getOuraTokenStatus.mockResolvedValue({ connected, syncStatus: "error" });
  getWhoopTokenStatus.mockResolvedValue({ connected: false, syncStatus: "never" });
  expect(await loadRecoveryData({ userId: "A" })).toBeNull();
  expect(readWearableSnapshot("A")).toMatchObject({ connected: true, recovery: { score: 78 }, savedAt: 1000 });
  expect(postServerSnapshot).not.toHaveBeenCalled();

  getOuraTokenStatus.mockResolvedValue({ connected: false, syncStatus: "never" });
  const result = await loadRecoveryData({ userId: "A" });
  expect(result.snapshot).toMatchObject({ connected: false, whoopConnected: false });
  expect(postServerSnapshot).toHaveBeenCalledOnce();
});
