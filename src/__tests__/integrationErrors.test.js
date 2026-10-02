// src/__tests__/integrationErrors.test.js
// Finding 3 — raw server sync error strings must be mapped to friendly,
// actionable copy and never surface verbatim in Settings.

import { describe, it, expect } from "vitest";
import { friendlySyncError } from "../integrationErrors";

describe("friendlySyncError", () => {
  it("maps a refresh-token failure to reconnect guidance (never the raw string)", () => {
    const m = friendlySyncError("Token refresh failed", "Whoop");
    expect(m.toLowerCase()).toContain("reconnect");
    expect(m).toContain("Whoop");
    expect(m).not.toContain("Token refresh failed");
  });

  it("maps a 'not connected' error to reconnect guidance", () => {
    expect(friendlySyncError("Whoop not connected").toLowerCase()).toContain("reconnect");
  });

  it("maps a generic 'Sync failed' to a transient retry message", () => {
    const m = friendlySyncError("Sync failed", "Oura");
    expect(m.toLowerCase()).toContain("retry");
    expect(m).not.toContain("Sync failed");
  });

  it("maps an auth error to sign-in guidance", () => {
    expect(friendlySyncError("Not authenticated").toLowerCase()).toContain("sign in");
  });

  it("maps a server-config error to a soft temporary-unavailable message", () => {
    expect(friendlySyncError("Server not configured").toLowerCase()).toContain("unavailable");
  });

  it("always returns non-empty copy for empty/null input", () => {
    expect(friendlySyncError("")).toBeTruthy();
    expect(friendlySyncError(null)).toBeTruthy();
    expect(friendlySyncError(undefined)).toBeTruthy();
  });

  it("reads sensibly without a provider label", () => {
    expect(friendlySyncError("Token refresh failed")).toContain("the connection");
  });
});
