import { pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveRecoveryHash, generateRecoverySalt, RECOVERY_KDF_CURRENT, RECOVERY_KDF_ITERATIONS } from "./recoveryKdf";

// Pinned vectors: the recovery endpoint recomputes these in Node, so the
// browser derivation must stay byte-identical to node:crypto's PBKDF2.
const VECTORS = [
  { phrase: "correct horse battery staple", salt: "00112233445566778899aabbccddeeff", hash: "afca0887b188255f525e15e30f5aa5a0b210a3e253bfaf9630411f0782bb6573" },
  { phrase: "amber cliff river stone wheat moss", salt: "f0e1d2c3b4a5968778695a4b3c2d1e0f", hash: "35f84ab6bd191a76eecb4b841ea35c2b634df62c6018b7aadeea25f4fc85c33a" },
];

describe("deriveRecoveryHash", () => {
  it.each(VECTORS)("matches node:crypto for $phrase", async ({ phrase, salt, hash }) => {
    const derived = await deriveRecoveryHash(phrase, salt);
    expect(derived).toEqual({ hash, salt, kdf: RECOVERY_KDF_CURRENT });
    expect(pbkdf2Sync(phrase, salt, RECOVERY_KDF_ITERATIONS, 32, "sha256").toString("hex")).toBe(hash);
  });

  it("trims the phrase, as the server does, and nothing else", async () => {
    const v = VECTORS[0]!;
    expect((await deriveRecoveryHash(`  ${v.phrase}\n`, v.salt)).hash).toBe(v.hash);
    expect((await deriveRecoveryHash(v.phrase.toUpperCase(), v.salt)).hash).not.toBe(v.hash);
  });

  it("generates a fresh 16-byte hex salt when none is given", async () => {
    const a = await deriveRecoveryHash("amber cliff river stone");
    const b = await deriveRecoveryHash("amber cliff river stone");
    expect(a.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("generateRecoverySalt", () => {
  it("is 32 hex characters and random", () => {
    const s = generateRecoverySalt();
    expect(s).toMatch(/^[0-9a-f]{32}$/);
    expect(s).not.toBe(generateRecoverySalt());
  });

  it("pins the KDF parameters the server expects", () => {
    expect(RECOVERY_KDF_CURRENT).toBe("pbkdf2-sha256-600k");
    expect(RECOVERY_KDF_ITERATIONS).toBe(600_000);
  });
});
