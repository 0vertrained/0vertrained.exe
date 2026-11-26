// src/__tests__/authScreen.test.jsx
// The signed-out screens: the home page, Sign in, Create an account in two
// steps, the closed beta, and Reset password.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

const auth = vi.hoisted(() => ({
  getSignupStatus: vi.fn(),
  logIn: vi.fn(),
  signUp: vi.fn(),
  resetPasswordWithRecovery: vi.fn(),
}));
vi.mock("../auth", () => auth);

import AuthScreen from "../AuthScreen";

afterEach(() => { cleanup(); window.location.hash = ""; });

beforeEach(() => {
  for (const fn of Object.values(auth)) fn.mockReset();
  auth.getSignupStatus.mockResolvedValue({ open: true, current: 1, max: 5 });
});

const type = (label, value) => fireEvent.change(screen.getByLabelText(label, { selector: "input" }), { target: { value } });
const openAt = async (hash, props = {}) => {
  window.location.hash = hash;
  const onAuthed = vi.fn();
  render(<AuthScreen onAuthed={onAuthed} {...props} />);
  await waitFor(() => expect(auth.getSignupStatus).toHaveBeenCalled());
  return onAuthed;
};

describe("Home page", () => {
  it("opens on the home page with the demo and Sign in", async () => {
    await openAt("");
    expect(screen.getByRole("heading", { level: 1, name: "How hard should today be?" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try the demo" }).getAttribute("href")).toBe("#/demo");
    expect(screen.getAllByRole("link", { name: "Sign in" }).every((link) => link.getAttribute("href") === "#signin")).toBe(true);
  });

  it("moves to Sign in when the address changes", async () => {
    await openAt("");
    await act(async () => { window.location.hash = "#signin"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
  });
});

describe("Sign in", () => {
  it("says what is missing under each field and keeps what was typed", async () => {
    await openAt("#signin");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your username.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(document.activeElement.id).toBe("signin-username");
    expect(auth.logIn).not.toHaveBeenCalled();

    auth.logIn.mockResolvedValue({ error: "Invalid username or password." });
    type("Username", "athlete01");
    type("Password", "wrong-pass1");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Invalid username or password.");
    expect(screen.getByLabelText("Username", { selector: "input" }).value).toBe("athlete01");
  });

  it("signs in with the pair typed", async () => {
    const onAuthed = await openAt("#signin");
    auth.logIn.mockResolvedValue({ user: { id: "u1" } });
    type("Username", " athlete01 ");
    type("Password", "secret-pass1");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith({ id: "u1" }));
    expect(auth.logIn).toHaveBeenCalledWith({ username: "athlete01", password: "secret-pass1" });
  });

  it("shows the password on request", async () => {
    await openAt("#signin");
    const input = screen.getByLabelText("Password", { selector: "input" });
    const show = screen.getByRole("button", { name: "Show password" });
    expect(input.type).toBe("password");
    fireEvent.click(show);
    expect(input.type).toBe("text");
    expect(show.getAttribute("aria-pressed")).toBe("true");
  });

  it("links to reset, sign-up and the demo", async () => {
    await openAt("#signin");
    expect(screen.getByRole("link", { name: /Forgot your password/ }).getAttribute("href")).toBe("#reset");
    expect(screen.getByRole("link", { name: /New here\?/ }).getAttribute("href")).toBe("#signup");
    expect(screen.getByRole("link", { name: /Just looking\?/ }).getAttribute("href")).toBe("#/demo");
  });
});

describe("Create an account", () => {
  it("checks the username and password before the phrase", async () => {
    await openAt("#signup");
    type("Username", "jo doe");
    type("Password", "lettersonly");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/Use only letters, numbers, dots, dashes and underscores/)).toBeTruthy();
    expect(screen.getByText(/Use 8 to 72 characters, with at least one number or symbol/)).toBeTruthy();
    expect(screen.queryByText("Save your recovery phrase.")).toBeNull();
  });

  it("suggests a phrase, needs the tick, then creates the account", async () => {
    const onAuthed = await openAt("#signup");
    type("Username", "athlete01");
    type("Password", "secret-pass1");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Save your recovery phrase.")).toBeTruthy();
    const phrase = screen.getByLabelText("Your recovery phrase").textContent;
    expect(phrase.split(" ")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.getByText("Tick the box once the phrase is saved.")).toBeTruthy();
    expect(document.activeElement.id).toBe("signup-saved");
    expect(auth.signUp).not.toHaveBeenCalled();

    auth.signUp.mockResolvedValue({ user: { id: "u2" } });
    fireEvent.click(screen.getByLabelText("I saved it somewhere safe"));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith({ id: "u2" }));
    expect(auth.signUp).toHaveBeenCalledWith({ username: "athlete01", password: "secret-pass1", recoveryPhrase: phrase });
  });

  it("takes a phrase of your own, of at least 8 characters", async () => {
    await openAt("#signup");
    type("Username", "athlete01");
    type("Password", "secret-pass1");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Use my own phrase instead" }));
    type("Your own recovery phrase", "short");
    fireEvent.click(screen.getByLabelText("I saved it somewhere safe"));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();

    auth.signUp.mockResolvedValue({ user: { id: "u3" } });
    type("Your own recovery phrase", "My Own Phrase 7");
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ recoveryPhrase: "My Own Phrase 7" })));
  });

  it("returns to the first step when the username is taken", async () => {
    await openAt("#signup");
    auth.signUp.mockResolvedValue({ error: "That username is taken." });
    type("Username", "athlete01");
    type("Password", "secret-pass1");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByLabelText("I saved it somewhere safe"));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByText("That username is taken.")).toBeTruthy();
    expect(screen.getByLabelText("Username", { selector: "input" }).getAttribute("aria-invalid")).toBe("true");
  });

  it("ends somewhere useful when the beta is full", async () => {
    auth.getSignupStatus.mockResolvedValue({ open: false, current: 5, max: 5 });
    await openAt("#signup");
    expect(await screen.findByText("The beta is full for now")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try the demo" }).getAttribute("href")).toBe("#/demo");
    expect(screen.getByRole("link", { name: "Email us" }).getAttribute("href")).toMatch(/^mailto:/);
  });
});

describe("Reset password", () => {
  it("checks each field, then resets and signs in", async () => {
    const onAuthed = await openAt("#reset");
    fireEvent.click(screen.getByRole("button", { name: "Reset and sign in" }));
    expect(screen.getByText("Enter your username.")).toBeTruthy();
    expect(screen.getByText("Enter the whole recovery phrase you saved.")).toBeTruthy();
    expect(auth.resetPasswordWithRecovery).not.toHaveBeenCalled();

    auth.resetPasswordWithRecovery.mockResolvedValue({ message: "Password reset." });
    auth.logIn.mockResolvedValue({ user: { id: "u4" } });
    type("Username", "athlete01");
    type("Recovery phrase", "amber canyon violet ridge");
    type("New password", "new-pass12");
    fireEvent.click(screen.getByRole("button", { name: "Reset and sign in" }));
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith({ id: "u4" }));
    expect(auth.resetPasswordWithRecovery).toHaveBeenCalledWith({ username: "athlete01", recoveryPhrase: "amber canyon violet ridge", newPassword: "new-pass12" });
  });

  it("shows the server's answer when the phrase does not match", async () => {
    await openAt("#reset");
    auth.resetPasswordWithRecovery.mockResolvedValue({ error: "The username or recovery phrase didn't match." });
    type("Username", "athlete01");
    type("Recovery phrase", "amber canyon violet");
    type("New password", "new-pass12");
    fireEvent.click(screen.getByRole("button", { name: "Reset and sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("didn't match");
    expect(auth.logIn).not.toHaveBeenCalled();
  });
});
