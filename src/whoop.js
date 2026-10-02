// src/whoop.js
// ─────────────────────────────────────────────────────────────────────────────
// Whoop Integration — Modular Re-export Facade (V2.9 Whoop Foundation)
//
// Mirrors src/oura.js. Re-exports the Whoop submodules so consumers can import
// from a single "./whoop" entrypoint. This sprint is FOUNDATION ONLY:
//   • OAuth connect / status / disconnect / manual 14-day sync
//   • owner-scoped data loading + display-only normalization
// It intentionally does NOT export any recovery-algorithm blending.
// ─────────────────────────────────────────────────────────────────────────────

import * as auth from "./whoop/auth";
import * as dataLoading from "./whoop/dataLoading";
import * as normalization from "./whoop/normalization";

// Auth & Connection Management
export {
  getWhoopAuthUrl,
  isWhoopConnected,
  getWhoopTokenStatus,
  syncWhoopNow,
  disconnectWhoop,
  getWhoopSyncCounts,
  getWhoopSyncEvents,
} from "./whoop/auth";

// Display cards (V3.0) — Recovery-tab wearable context. Display only; these
// components never feed the recovery algorithm.
export { WhoopRecoveryCard } from "./whoop/WhoopRecoveryCard";
export { WhoopSleepCard } from "./whoop/WhoopSleepCard";
export { WhoopStrainCard } from "./whoop/WhoopStrainCard";
export { WhoopSourceSummary } from "./whoop/WhoopSourceSummary";

// Data Loading
export {
  loadWhoopData,
} from "./whoop/dataLoading";

// Data Normalization (display-only)
export {
  normalizeRecovery,
  normalizeSleep,
  normalizeCycle,
  normalizeWorkout,
  latestWhoopDate,
  buildWhoopSummary,
} from "./whoop/normalization";

export default {
  ...auth,
  ...dataLoading,
  ...normalization,
};
