import { describe, expect, it } from "vitest";
import { isValidPhrase, normalizePhrase, PASSWORD_RULE, sanitizeUsername, USERNAME_RULE, usernameToEmail, validatePassword, validateUsername } from "./auth";
import { generateRecoveryPhrase, RECOVERY_WORDS } from "./recoveryWords";

describe("sanitizeUsername", () => {
  it.each([
    ["  Alex  ", "alex"],
    ["Mia.Jones_99", "mia.jones_99"],
    ["bad name!", "badname"],
    ["émile", "mile"],
    ["", ""],
  ])("%j → %j", (raw, clean) => {
    expect(sanitizeUsername(raw)).toBe(clean);
  });
});

describe("validateUsername", () => {
  it.each<[string, string | null]>([
    ["alex", null],
    ["a.b-c_1", null],
    ["a".repeat(32), null],
    ["", "Enter a username."],
    ["ab", "Use at least 3 characters."],
    ["a".repeat(33), "Use 32 characters or fewer."],
    ["Alex", USERNAME_RULE],
    ["al ex", USERNAME_RULE],
  ])("%j → %j", (name, message) => {
    expect(validateUsername(name)).toBe(message);
  });
});

describe("validatePassword", () => {
  it.each<[string, string | null]>([
    ["hunter2!", null],
    ["eightchars1", null],
    ["symbols only ...", null],
    ["a1".repeat(36), null],
    ["", "Enter a password."],
    ["short1!", PASSWORD_RULE],
    ["onlyletters", PASSWORD_RULE],
    ["a1".repeat(36) + "x", PASSWORD_RULE],
  ])("%j → %j", (pw, message) => {
    expect(validatePassword(pw)).toBe(message);
  });
});

describe("usernameToEmail", () => {
  it("joins the lower-cased username and domain", () => {
    expect(usernameToEmail("Alex", "Users.0vertrained.app")).toBe("alex@users.0vertrained.app");
    expect(usernameToEmail(" mia ", "users.0vertrained.app")).toBe("mia@users.0vertrained.app");
  });
});

describe("generateRecoveryPhrase", () => {
  it("draws from exactly 256 distinct plain words", () => {
    expect(RECOVERY_WORDS).toHaveLength(256);
    expect(new Set(RECOVERY_WORDS).size).toBe(256);
    for (const w of RECOVERY_WORDS) expect(w).toMatch(/^[a-z]{3,8}$/);
    const banned = /hunter|shadow|arise|player|awaken|dungeon|boss|grind|beast|crush|destroy/;
    expect(RECOVERY_WORDS.filter((w) => banned.test(w))).toEqual([]);
  });

  it("makes six words by default, each from the list, separated by single spaces", () => {
    const phrase = generateRecoveryPhrase();
    const words = phrase.split(" ");
    expect(words).toHaveLength(6);
    expect(phrase).toMatch(/^[a-z]+( [a-z]+){5}$/);
    for (const w of words) expect(RECOVERY_WORDS).toContain(w);
  });

  it("honours the word count and varies between calls", () => {
    expect(generateRecoveryPhrase(4).split(" ")).toHaveLength(4);
    expect(generateRecoveryPhrase(1).split(" ")).toHaveLength(1);
    expect(generateRecoveryPhrase()).not.toBe(generateRecoveryPhrase());
  });
});

describe("normalizePhrase and isValidPhrase", () => {
  it("trims, collapses whitespace and lower-cases", () => {
    expect(normalizePhrase("  Amber   Cliff\n river ")).toBe("amber cliff river");
  });

  it("needs at least 8 characters after normalising", () => {
    expect(isValidPhrase("amber cliff")).toBe(true);
    expect(isValidPhrase("   short  ")).toBe(false);
    expect(isValidPhrase("")).toBe(false);
  });
});
