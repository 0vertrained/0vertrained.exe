import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_COPY } from "../../auth/authErrors";
import { AuthProvider } from "../../auth/AuthProvider";
import { createFakeAuthClient, type FakeAuthClient } from "../../auth/fakeAuthClient";
import { RECOVERY_WORDS } from "../../auth/recoveryWords";
import { expectNoA11yViolations } from "../../test/axe";
import { AuthSheet, type AuthSheetProps } from "./AuthSheet";
import { PHRASE_NOTE } from "./CreateForm";

const PASSWORD = "hunter2!!";

function renderSheet(client: FakeAuthClient = createFakeAuthClient(), props: Partial<AuthSheetProps> = {}) {
  const onClose = vi.fn();
  const onSignedIn = vi.fn();
  const utils = render(
    <AuthProvider client={client} enabled>
      <AuthSheet onClose={onClose} onSignedIn={onSignedIn} {...props} />
    </AuthProvider>,
  );
  return { onClose, onSignedIn, client, ...utils };
}

const primaries = (container: HTMLElement) => container.querySelectorAll("[data-primary]");
const field = (name: string) => screen.getByLabelText(name);

afterEach(() => vi.unstubAllGlobals());

describe("AuthSheet sign-in", () => {
  it("submits the username and password and reports the session", async () => {
    const { container, onSignedIn, client } = renderSheet(createFakeAuthClient({ accounts: { alex: PASSWORD } }));
    expect(screen.getByRole("dialog", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "0VERTRAINED" })).toBeInTheDocument();
    expect(primaries(container)).toHaveLength(1);
    expect(field("Password")).toHaveAttribute("type", "password");
    expect(field("Password")).toHaveAttribute("autocomplete", "current-password");
    await expectNoA11yViolations(container);

    await userEvent.type(field("Username"), "Alex");
    await userEvent.type(field("Password"), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("signed-in"));
    expect(client.calls.signIn[0]).toEqual({ email: "alex@users.0vertrained.app", password: PASSWORD });
  });

  it("marks empty fields inline, shows the server's copy as a notice, and submits on Enter", async () => {
    const { onSignedIn } = renderSheet(createFakeAuthClient({ accounts: { alex: PASSWORD } }));
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText(AUTH_COPY.enterUsername)).toBeInTheDocument();
    expect(screen.getByText(AUTH_COPY.enterPassword)).toBeInTheDocument();
    expect(field("Username")).toHaveAttribute("aria-invalid", "true");

    await userEvent.type(field("Username"), "alex");
    await userEvent.type(field("Password"), "wrong-pass-1{Enter}");
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("[ERROR]");
    expect(notice).toHaveTextContent(AUTH_COPY.wrongCredentials);
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("closes from the Close control and never loads the captcha script without a key", async () => {
    const { onClose } = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector("script[src*='turnstile']")).toBeNull();
  });
});

describe("AuthSheet create", () => {
  it("shows a six-word phrase, gates the primary on the Switch, and creates the account", async () => {
    const { container, onSignedIn, client } = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("dialog", { name: "Create account" })).toBeInTheDocument();
    expect(primaries(container)).toHaveLength(1);
    await expectNoA11yViolations(container);

    const region = screen.getByRole("region", { name: "Recovery phrase" });
    const phrase = within(region).getByText(/^[a-z]+( [a-z]+){5}$/).textContent ?? "";
    for (const w of phrase.split(" ")) expect(RECOVERY_WORDS).toContain(w);
    expect(within(region).getByText(PHRASE_NOTE)).toBeInTheDocument();

    const primary = screen.getByRole("button", { name: "Create account" });
    expect(primary).toBeDisabled();
    expect(field("Password")).toHaveAttribute("autocomplete", "new-password");
    await userEvent.type(field("Username"), "New.User");
    await userEvent.type(field("Password"), PASSWORD);
    await userEvent.click(screen.getByRole("switch", { name: "I have saved my recovery phrase" }));
    expect(primary).toBeEnabled();
    await userEvent.click(primary);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("signed-up"));
    expect(client.calls.signUp[0]).toEqual({ email: "new.user@users.0vertrained.app", password: PASSWORD, options: { data: { username: "new.user" } } });
    // The blur check and the sign-up check both ask the server; the phrase is stored last.
    expect(client.calls.rpc.filter((c) => c.fn === "username_taken").map((c) => c.args)).toEqual([{ p_username: "new.user" }, { p_username: "new.user" }]);
    expect(client.calls.rpc.at(-1)?.fn).toBe("set_recovery_phrase");
    expect(client.accounts.get("new.user")?.phrase?.salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it("checks a taken username on blur and copies the phrase", async () => {
    renderSheet(createFakeAuthClient({ accounts: { alex: PASSWORD } }), { initialMode: "create" });
    await userEvent.type(field("Username"), "alex");
    await userEvent.tab();
    expect(await screen.findByText(AUTH_COPY.usernameTaken)).toBeInTheDocument();
    await userEvent.clear(field("Username"));
    await userEvent.type(field("Username"), "ab");
    await userEvent.tab();
    expect(await screen.findByText("Use at least 3 characters.")).toBeInTheDocument();

    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^[a-z]+( [a-z]+){5}$/));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("returns to sign in from the ghost", async () => {
    renderSheet(undefined, { initialMode: "create" });
    await userEvent.click(screen.getByRole("button", { name: "Sign in instead" }));
    expect(screen.getByRole("dialog", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("AuthSheet forgot", () => {
  it("resets the password through the endpoint and signs in", async () => {
    const client = createFakeAuthClient({ accounts: { alex: "old-pass-1" } });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { newPassword: string };
      client.accounts.set("alex", { password: body.newPassword });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, onSignedIn } = renderSheet(client);
    await userEvent.click(screen.getByRole("button", { name: "Forgot password" }));
    expect(screen.getByRole("dialog", { name: "Reset password" })).toBeInTheDocument();
    expect(primaries(container)).toHaveLength(1);
    expect(field("Recovery phrase").tagName).toBe("TEXTAREA");
    await expectNoA11yViolations(container);

    await userEvent.type(field("Username"), "alex");
    await userEvent.type(field("Recovery phrase"), "Amber cliff river stone wheat moss");
    await userEvent.type(field("New password"), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("signed-in"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/next/account-recovery");
    expect(JSON.parse(String(init.body))).toEqual({ username: "alex", recoveryPhrase: "amber cliff river stone wheat moss", newPassword: PASSWORD });
    expect(client.calls.signIn[0]).toEqual({ email: "alex@users.0vertrained.app", password: PASSWORD });
  });

  it("shows the mismatch copy when the server refuses, and asks for the phrase when empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "no match" }), { status: 403 })));
    const { onSignedIn } = renderSheet(createFakeAuthClient({ accounts: { alex: PASSWORD } }), { initialMode: "forgot" });
    await userEvent.type(field("Username"), "alex");
    await userEvent.type(field("New password"), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(screen.getByText(AUTH_COPY.enterPhrase)).toBeInTheDocument();
    await userEvent.type(field("Recovery phrase"), "wrong words here{Enter}");
    const notices = await screen.findAllByRole("alert");
    expect(notices.some((n) => n.textContent?.includes(AUTH_COPY.phraseMismatch))).toBe(true);
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});
