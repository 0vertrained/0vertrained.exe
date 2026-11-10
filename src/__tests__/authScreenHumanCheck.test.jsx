// src/__tests__/authScreenHumanCheck.test.jsx
// @vitest-environment jsdom
// The sign-in form with the human check (AuthScreen.jsx, HumanCheck.jsx).
// Off, the form is what it was and Cloudflare is never contacted. On, the
// check starts when someone first touches the form, each attempt waits for
// its token and sends it, and a check that cannot finish is said in the
// form's own error line. The auth layer and the landing page are stand-ins;
// the check itself is a stand-in only where a test needs to play Cloudflare.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ check: null, signupOpen: false, logIn: null, signUp: null, reset: null }));

vi.mock("../auth", () => ({
  getSignupStatus: async () => ({ open: h.signupOpen, current: 2, max: 5 }),
  logIn: (request) => h.logIn(request),
  signUp: (request) => h.signUp(request),
  resetPasswordWithRecovery: (request) => h.reset(request),
}));
vi.mock("../landing/LandingPage", () => ({ default: () => null, Wordmark: () => null }));
// The real check unless a test supplies one to play Cloudflare with.
vi.mock("../humanCheck", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createHumanCheck: (...args) => h.check ?? actual.createHumanCheck(...args) };
});

import AuthScreen from "../AuthScreen";
import { HumanCheckError } from "../humanCheck";
import { ThemeProvider } from "../theme";

const USER = { id: "user-1" };
const onAuthed = vi.fn();

// A check the test answers for: token() waits until the test settles it.
function fakeCheck() {
  const check = {
    enabled: true,
    start: vi.fn(async () => {}),
    token: vi.fn(() => new Promise((resolve, reject) => { check.answer = resolve; check.fail = reject; })),
    renew: vi.fn(),
    stop: vi.fn(),
  };
  return check;
}

beforeEach(() => {
  h.check = null;
  h.signupOpen = false;
  h.logIn = vi.fn(async () => ({ user: USER }));
  h.signUp = vi.fn(async () => ({ user: USER }));
  h.reset = vi.fn(async () => ({ ok: true }));
  onAuthed.mockClear();
  document.head.innerHTML = "";
  window.matchMedia = window.matchMedia || ((query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(cleanup);

// The form once it has heard whether sign-up is open: creating an account when there is room, signing in when full.
async function form() {
  render(<ThemeProvider><AuthScreen onAuthed={onAuthed} /></ThemeProvider>);
  if (h.signupOpen) await screen.findByRole("button", { name: "Create Account" });
  else await screen.findByText(/Signup is full \(2\/5 users\)/);
}
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const send = (name) => fireEvent.click(screen.getByRole("button", { name }));
const slot = () => document.querySelector("[data-human-check]");

describe("with the human check off", () => {
  it("draws nothing, never contacts Cloudflare, and signs in as before", async () => {
    await form();
    fireEvent.focusIn(screen.getByLabelText("Username"));
    fill("Username", "riley");
    fill("Password", "correct-horse-9");
    send("Sign In");
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(USER));
    expect(h.logIn).toHaveBeenCalledWith({ username: "riley", password: "correct-horse-9", captchaToken: undefined });
    expect(slot()).toBeNull();
    expect(document.head.querySelector("script")).toBeNull();
  });
});

describe("with the human check on", () => {
  beforeEach(() => { h.check = fakeCheck(); });

  it("leaves Cloudflare alone until someone touches the form", async () => {
    await form();
    expect(slot()).not.toBeNull();
    expect(h.check.start).not.toHaveBeenCalled();
    fireEvent.focusIn(screen.getByLabelText("Username"));
    expect(h.check.start).toHaveBeenCalledWith(slot(), expect.objectContaining({ theme: "light" }));
  });

  it("makes a sign-in wait for its token, then sends it", async () => {
    await form();
    fill("Username", "riley");
    fill("Password", "correct-horse-9");
    send("Sign In");
    await waitFor(() => expect(h.check.token).toHaveBeenCalledTimes(1));
    expect(h.logIn).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "..." }).disabled).toBe(true);

    await act(async () => { h.check.answer("token-1"); });
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(USER));
    expect(h.logIn).toHaveBeenCalledWith({ username: "riley", password: "correct-horse-9", captchaToken: "token-1" });
    expect(h.check.renew).not.toHaveBeenCalled();
  });

  it("asks for a new token after an attempt that failed", async () => {
    h.logIn.mockResolvedValue({ error: "Invalid username or password." });
    await form();
    fill("Username", "riley");
    fill("Password", "wrong-password-1");
    send("Sign In");
    await waitFor(() => expect(h.check.token).toHaveBeenCalled());
    await act(async () => { h.check.answer("token-1"); });
    expect((await screen.findByRole("alert")).textContent).toBe("Invalid username or password.");
    expect(h.check.renew).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sign In" }).disabled).toBe(false);
  });

  it("says why when the check cannot finish, and sends nothing", async () => {
    await form();
    fill("Username", "riley");
    fill("Password", "correct-horse-9");
    send("Sign In");
    await waitFor(() => expect(h.check.token).toHaveBeenCalled());
    await act(async () => { h.check.fail(new HumanCheckError("The human check could not load. If a content blocker is on, allow challenges.cloudflare.com for this site, then reload.")); });
    expect((await screen.findByRole("alert")).textContent).toMatch(/^The human check could not load\./);
    expect(h.logIn).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign In" }).disabled).toBe(false);
  });

  it("says there is one more step while Cloudflare's box is open, and makes room for it", async () => {
    await form();
    fireEvent.focusIn(screen.getByLabelText("Username"));
    const { onInteractive } = h.check.start.mock.calls[0][1];
    expect(slot().style.marginTop).toBe("0px");

    act(() => onInteractive(true));
    expect(screen.getByRole("status").textContent).toBe("One more step: confirm you're human in the box below.");
    expect(slot().style.marginTop).toBe("16px");

    act(() => onInteractive(false));
    expect(screen.queryByRole("status")).toBeNull();
    expect(slot().style.marginTop).toBe("0px");
  });

  it("keeps saying so after the form is sent, while it waits for the person", async () => {
    await form();
    fill("Username", "riley");
    fill("Password", "correct-horse-9");
    fireEvent.focusIn(screen.getByLabelText("Username"));
    act(() => h.check.start.mock.calls[0][1].onInteractive(true));
    send("Sign In");
    await waitFor(() => expect(h.check.token).toHaveBeenCalled());
    expect(screen.getByRole("status").textContent).toBe("One more step: confirm you're human in the box below.");
    expect(h.logIn).not.toHaveBeenCalled();

    await act(async () => {
      h.check.start.mock.calls[0][1].onInteractive(false);
      h.check.answer("token-1");
    });
    await waitFor(() => expect(h.logIn).toHaveBeenCalledWith(expect.objectContaining({ captchaToken: "token-1" })));
  });

  it("checks a new account's form before it spends a token, then sends the token with it", async () => {
    h.signupOpen = true;
    await form();
    fill("Username", "riley");
    fill("Password", "correct-horse-9");
    fill("Confirm Password", "something-else-9");
    fill("Recovery Phrase", "a phrase only I know");
    fill("Confirm Recovery Phrase", "a phrase only I know");
    send("Create Account");
    expect((await screen.findByRole("alert")).textContent).toBe("Passwords do not match.");
    expect(h.check.token).not.toHaveBeenCalled();

    fill("Confirm Password", "correct-horse-9");
    send("Create Account");
    await waitFor(() => expect(h.check.token).toHaveBeenCalledTimes(1));
    await act(async () => { h.check.answer("token-1"); });
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(USER));
    expect(h.signUp).toHaveBeenCalledWith({ username: "riley", password: "correct-horse-9", recoveryPhrase: "a phrase only I know", captchaToken: "token-1" });
  });

  it("takes the check away for a password reset, which asks for no token", async () => {
    await form();
    fireEvent.click(screen.getByRole("button", { name: "› Forgot password?" }));
    expect(slot()).toBeNull();
    expect(h.check.stop).toHaveBeenCalledTimes(1);

    fill("Username", "riley");
    fill("Recovery Phrase", "a phrase only I know");
    fill("New Password", "correct-horse-9");
    fill("Confirm New Password", "correct-horse-9");
    send("Reset Password");
    await waitFor(() => expect(h.reset).toHaveBeenCalledTimes(1));
    expect(h.check.token).not.toHaveBeenCalled();
  });
});
