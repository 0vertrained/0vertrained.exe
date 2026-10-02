import { describe, expect, it } from "vitest";
// The endpoint is self-contained but exports its pure sanitizer/status helpers
// for exactly this test. Importing the module does not execute any handler.
import { sanitizeForClient, deriveStatus } from "../../netlify/functions/wearable-snapshot.js";

describe("wearable-snapshot server surface", () => {
  describe("sanitizeForClient", () => {
    it("strips token-like fields defensively (defence-in-depth over RLS)", () => {
      const out = sanitizeForClient({
        recovery: { score: 91 },
        access_token: "leak",
        refresh_token: "leak",
        service_role_key: "leak",
        nested: { authorization: "Bearer leak", client_secret: "leak", label: "kept" },
        rows: [{ jwt: "leak", source: "whoop" }],
      });
      expect(JSON.stringify(out)).not.toContain("leak");
      expect(out.recovery.score).toBe(91);
      expect(out.nested.label).toBe("kept");
      expect(out.rows[0].source).toBe("whoop");
    });

    it("keeps non-secret sync metadata like tokenStatus/syncStatus", () => {
      const out = sanitizeForClient({ tokenStatus: { syncStatus: "recent", lastSynced: "2026-07-09" } });
      expect(out.tokenStatus.syncStatus).toBe("recent");
    });
  });

  describe("deriveStatus", () => {
    const now = Date.parse("2026-07-09T12:00:00Z");
    it("empty when no snapshot", () => {
      expect(deriveStatus({ hasSnapshot: false, updatedAt: new Date(now).toISOString(), now })).toBe("empty");
    });
    it("fresh for a recent write", () => {
      const updatedAt = new Date(now - 60_000).toISOString();
      expect(deriveStatus({ hasSnapshot: true, updatedAt, now })).toBe("fresh");
    });
    it("stale for an old write or a missing timestamp", () => {
      const updatedAt = new Date(now - 7 * 60 * 60 * 1000).toISOString();
      expect(deriveStatus({ hasSnapshot: true, updatedAt, now })).toBe("stale");
      expect(deriveStatus({ hasSnapshot: true, updatedAt: null, now })).toBe("stale");
    });
  });
});
