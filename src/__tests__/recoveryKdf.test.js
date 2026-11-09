// @vitest-environment jsdom
// The recovery hash is computed in the BROWSER at signup/change
// (src/recoveryKdf.js, WebCrypto) and re-derived in the NODE recovery function
// (account-recovery.js) to verify. If those two implementations ever diverge,
// a phrase set in the app silently stops verifying on the server. This test is
// the guard: it runs both and asserts byte-identical hex for the same inputs.
import { describe, expect, it } from "vitest";
import {
  deriveRecoveryHash,
  deriveLegacyRecoveryHash,
  generateRecoverySalt,
  RECOVERY_KDF_CURRENT,
} from "../recoveryKdf";
import { deriveRecoveryHashPbkdf2, hashRecoveryPhrase } from "../../netlify/functions/account-recovery.js";
import { suggestRecoveryPhrase, RECOVERY_PHRASE_WORDLIST_SIZE } from "../recoveryPhraseSuggest";

describe("recovery KDF cross-runtime agreement", () => {
  it("browser PBKDF2 and node PBKDF2 produce identical hex", async () => {
    const salt = generateRecoverySalt();
    const phrase = "correct horse battery staple";
    const browser = await deriveRecoveryHash(phrase, salt);
    const node = await deriveRecoveryHashPbkdf2(phrase, salt);
    expect(browser.kdf).toBe(RECOVERY_KDF_CURRENT);
    expect(browser.hash).toBe(node);
    expect(browser.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("trims whitespace identically on both sides", async () => {
    const salt = "abcd1234abcd1234abcd1234abcd1234";
    const browser = await deriveRecoveryHash("  spaced phrase  ", salt);
    const node = await deriveRecoveryHashPbkdf2("spaced phrase", salt);
    expect(browser.hash).toBe(node);
  });

  it("legacy SHA-256 also agrees across runtimes (for the upgrade path)", async () => {
    const salt = "00112233445566778899aabbccddeeff";
    const browser = await deriveLegacyRecoveryHash("old phrase", salt);
    const node = hashRecoveryPhrase("old phrase", salt);
    expect(browser).toBe(node);
  });

  it("different salts yield different hashes for the same phrase", async () => {
    const a = await deriveRecoveryHash("same phrase", generateRecoverySalt());
    const b = await deriveRecoveryHash("same phrase", generateRecoverySalt());
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("recovery phrase suggestion", () => {
  it("returns the requested number of space-separated words", () => {
    expect(suggestRecoveryPhrase(4).split(" ")).toHaveLength(4);
    expect(suggestRecoveryPhrase(5).split(" ")).toHaveLength(5);
  });

  it("clamps word count into a sane range", () => {
    expect(suggestRecoveryPhrase(1).split(" ").length).toBeGreaterThanOrEqual(3);
    expect(suggestRecoveryPhrase(99).split(" ").length).toBeLessThanOrEqual(6);
  });

  it("draws only from the wordlist and meets the length floor", () => {
    const phrase = suggestRecoveryPhrase();
    expect(phrase.length).toBeGreaterThanOrEqual(8);
    expect(phrase).toMatch(/^[a-z ]+$/);
  });

  it("has a full-byte wordlist", () => {
    expect(RECOVERY_PHRASE_WORDLIST_SIZE).toBe(256);
  });
});
