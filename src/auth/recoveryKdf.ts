// Recovery-phrase key derivation, browser side: PBKDF2-SHA256 at 600k
// iterations, 32 bytes out as hex, with a 16-byte hex salt. The recovery
// endpoint recomputes this in Node to verify, so both sides must feed the
// trimmed phrase and the salt string as UTF-8 bytes with the same count
// and length. recoveryKdf.test.ts pins the output against node:crypto;
// change the parameters here, the server and that test together.

export const RECOVERY_KDF_CURRENT = "pbkdf2-sha256-600k";
export const RECOVERY_KDF_ITERATIONS = 600_000;
const KEY_LENGTH_BYTES = 32;
const SALT_BYTES = 16;

export interface RecoveryHash {
  /** 64 hex characters. */
  hash: string;
  /** 32 hex characters; stored beside the hash. */
  salt: string;
  /** The KDF id the server reads to pick its verifier. */
  kdf: string;
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 16 random bytes as 32 hex characters. */
export function generateRecoverySalt(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** The hash, salt and KDF id ready for set_recovery_phrase. */
export async function deriveRecoveryHash(phrase: string, salt: string = generateRecoverySalt()): Promise<RecoveryHash> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(phrase.trim()), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: RECOVERY_KDF_ITERATIONS, hash: "SHA-256" },
    key,
    KEY_LENGTH_BYTES * 8,
  );
  return { hash: toHex(bits), salt, kdf: RECOVERY_KDF_CURRENT };
}
