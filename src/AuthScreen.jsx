// src/AuthScreen.jsx
// Signed out: the home page, Sign in, Create an account (a username and
// password, then the recovery phrase) and Reset password with the recovery
// phrase. Each screen has its own address (#signin, #signup, #reset), so the
// browser's Back works and the demo can link straight to them.
import { useEffect, useRef, useState } from "react";
import { signUp, logIn, resetPasswordWithRecovery, getSignupStatus } from "./auth";
import { buildSupportMailto } from "./appMeta";
import { suggestRecoveryPhrase } from "./recoveryPhraseSuggest";
import { Icon, TopBar, Wordmark } from "./ui/ledger";
import LandingPage from "./landing/LandingPage";
import { PublicFooter } from "./landing/PublicFooter";

const VIEWS = { "#signin": "signin", "#signup": "signup", "#reset": "reset" };
const USERNAME_RULE = "Letters, numbers, dots, dashes and underscores.";
const PASSWORD_RULE = "8 to 72 characters, with at least one number or symbol.";
const PLACE_MAILTO = buildSupportMailto({ subject: "0VERTRAINED beta place" });

function viewFromHash() {
  if (typeof window === "undefined") return "home";
  const hash = window.location.hash || "";
  if (VIEWS[hash]) return VIEWS[hash];
  // The installed app opens on Sign in: whoever opens it already knows it.
  const installed = Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches);
  return installed && !hash ? "signin" : "home";
}

const go = (hash) => { window.location.hash = hash; };
const usernameProblem = (value) => {
  const name = value.trim();
  if (!name) return "Enter a username.";
  if (/[^a-zA-Z0-9._-]/.test(name)) return `Use only ${USERNAME_RULE.toLowerCase()}`;
  return "";
};
const passwordProblem = (value) => (value.length < 8 || value.length > 72 || !/[^a-zA-Z]/.test(value) ? `Use ${PASSWORD_RULE.charAt(0).toLowerCase()}${PASSWORD_RULE.slice(1)}` : "");
const focusFirst = (ids) => { const id = ids.find(Boolean); if (id) document.getElementById(id)?.focus(); };

function FieldError({ id, children }) {
  return <p id={id} className="err"><Icon name="warn" size="s" /><span>{children}</span></p>;
}

function FormError({ children }) {
  return <p className="err" role="alert"><Icon name="warn" size="s" /><span>{children}</span></p>;
}

function TextField({ id, label, hint, error, value, onChange, autoComplete, mono = false }) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label className="lbl" htmlFor={id}>{label}</label>
      {hint && <span id={`${id}-hint`} className="hint">{hint}</span>}
      <input
        id={id}
        className={mono ? "input n" : "input"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
      />
      {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
    </div>
  );
}

// Show toggles the password, so there is no second field to type it into.
function PasswordField({ id, label, hint, error, value, onChange, autoComplete }) {
  const [shown, setShown] = useState(false);
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label className="lbl" htmlFor={id}>{label}</label>
      {hint && <span id={`${id}-hint`} className="hint">{hint}</span>}
      <span style={{ display: "flex", gap: 8 }}>
        <input
          id={id}
          className="input"
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
        />
        <button type="button" className="btn btn-s" aria-pressed={shown} aria-controls={id} aria-label="Show password" onClick={() => setShown((value) => !value)}>Show</button>
      </span>
      {error && <FieldError id={`${id}-err`}>{error}</FieldError>}
    </div>
  );
}

function LinkRow({ href, title, sub }) {
  return (
    <li>
      <a className="row" href={href}>
        <span className="kv grow"><span className="t-bs">{title}</span><span className="t-s c2">{sub}</span></span>
        <Icon name="next" size="s" className="c2" />
      </a>
    </li>
  );
}

function SignIn({ username, setUsername, notice, signupOpen, onAuthed }) {
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const next = {
      username: username.trim() ? "" : "Enter your username.",
      password: password ? "" : "Enter your password.",
    };
    setErrors(next);
    if (next.username || next.password) { focusFirst([next.username && "signin-username", next.password && "signin-password"]); return; }
    setBusy(true);
    const res = await logIn({ username: username.trim(), password });
    setBusy(false);
    if (res.error) { setErrors({ form: res.error }); return; }
    onAuthed(res.user);
  };

  return (
    <div className="shell">
      <header className="top">
        <a href="#home" aria-label="0VERTRAINED home" style={{ display: "flex", alignItems: "center", minHeight: 44 }}><Wordmark /></a>
      </header>
      <main className="main" style={{ gap: 16, paddingTop: 24 }}>
        <div className="kv" style={{ gap: 6 }}>
          <h1 className="t-xl" tabIndex={-1}>Sign in</h1>
          <p className="t-b c2">Your training ledger, private to you.</p>
        </div>
        {notice && <p className="banner" role="status">{notice}</p>}
        <form noValidate onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TextField id="signin-username" label="Username" autoComplete="username" value={username} onChange={setUsername} error={errors.username} />
          <PasswordField id="signin-password" label="Password" autoComplete="current-password" value={password} onChange={setPassword} error={errors.password} />
          {errors.form && <FormError>{errors.form}</FormError>}
          <button type="submit" className="btn btn-p btn-lg btn-b" aria-disabled={busy || undefined}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        <ul className="rows" style={{ margin: "8px 0 0", padding: 0, listStyle: "none" }}>
          <LinkRow href="#reset" title="Forgot your password?" sub="Reset it with your recovery phrase" />
          {signupOpen
            ? <LinkRow href="#signup" title="New here?" sub="Create an account. No email needed." />
            : <LinkRow href={PLACE_MAILTO} title="New here?" sub="The beta is full for now. Email us to ask for a place." />}
          <LinkRow href="#/demo" title="Just looking?" sub="Try the demo. No account needed." />
        </ul>
      </main>
      <PublicFooter />
    </div>
  );
}

function SignupClosed() {
  return (
    <div className="shell">
      <TopBar title="Create an account" back="Sign in" onBack={() => go("#signin")} />
      <main className="main" style={{ gap: 16, paddingTop: 12 }}>
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="t-title">The beta is full for now</h2>
          <p className="t-b c2">Sign-ups reopen as places free up. You can try the demo now, or email us to ask for a place.</p>
          <a className="btn btn-p btn-b" href="#/demo">Try the demo</a>
          <a className="btn btn-s btn-b" href={PLACE_MAILTO}>Email us</a>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

function SignUp({ username, setUsername, onAuthed }) {
  const [step, setStep] = useState(1);
  const [password, setPassword] = useState("");
  const [phrase] = useState(() => suggestRecoveryPhrase());
  const [ownPhrase, setOwnPhrase] = useState(false);
  const [custom, setCustom] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const stepTitle = useRef(null);

  const toStep = (next) => {
    setStep(next);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => (next === 2 ? stepTitle.current : document.getElementById("signup-title"))?.focus());
  };

  const toPhrase = (event) => {
    event.preventDefault();
    const next = { username: usernameProblem(username), password: passwordProblem(password) };
    setErrors(next);
    if (next.username || next.password) { focusFirst([next.username && "signup-username", next.password && "signup-password"]); return; }
    toStep(2);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(phrase); setCopied("ok"); }
    catch { setCopied("failed"); }
  };

  const finish = async () => {
    if (busy) return;
    const chosen = ownPhrase ? custom.trim() : phrase;
    const next = {
      phrase: ownPhrase && chosen.length < 8 ? "Use at least 8 characters." : "",
      saved: saved ? "" : "Tick the box once the phrase is saved.",
    };
    setErrors(next);
    if (next.phrase || next.saved) { focusFirst([next.phrase && "signup-phrase", next.saved && "signup-saved"]); return; }
    setBusy(true);
    const res = await signUp({ username: username.trim(), password, recoveryPhrase: chosen });
    setBusy(false);
    if (!res.error) { onAuthed(res.user); return; }
    // A username or password problem belongs to the first step.
    if (/username/i.test(res.error)) { setErrors({ username: res.error }); toStep(1); return; }
    if (/password/i.test(res.error)) { setErrors({ password: res.error }); toStep(1); return; }
    setErrors({ form: res.error });
  };

  if (step === 1) {
    return (
      <div className="shell">
        <TopBar title="Create an account" sub=" · step 1 of 2" back="Sign in" onBack={() => go("#signin")} />
        <main className="main" style={{ gap: 16, paddingTop: 12 }}>
          <div className="kv" style={{ gap: 8 }}>
            <h2 id="signup-title" className="t-xl" tabIndex={-1}>Choose a username and password.</h2>
            <p className="t-b c2">No email needed. Next, you save a recovery phrase.</p>
          </div>
          <form id="signup-account" noValidate onSubmit={toPhrase} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <TextField id="signup-username" label="Username" hint={USERNAME_RULE} autoComplete="username" value={username} onChange={setUsername} error={errors.username} />
            <PasswordField id="signup-password" label="Password" hint={PASSWORD_RULE} autoComplete="new-password" value={password} onChange={setPassword} error={errors.password} />
          </form>
        </main>
        <div className="foot"><button type="submit" form="signup-account" className="btn btn-p btn-lg btn-b">Continue</button></div>
      </div>
    );
  }

  return (
    <div className="shell">
      <TopBar title="Create an account" sub=" · step 2 of 2" back="Back" onBack={() => toStep(1)} />
      <main className="main" style={{ gap: 16, paddingTop: 12 }}>
        <div className="kv" style={{ gap: 8 }}>
          <h2 ref={stepTitle} className="t-xl" tabIndex={-1}>Save your recovery phrase.</h2>
          <p className="t-b c2">We keep no email for you, so this phrase is the only way to reset your password. Store it in a password manager or write it down.</p>
        </div>
        {ownPhrase ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <TextField id="signup-phrase" label="Your own recovery phrase" hint="At least 8 characters. Type it exactly: capitals count." autoComplete="off" mono value={custom} onChange={setCustom} error={errors.phrase} />
            <button type="button" className="btn btn-g" style={{ alignSelf: "flex-start", marginLeft: -10 }} onClick={() => { setOwnPhrase(false); setErrors({}); }}>Use the suggested phrase</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span id="signup-phrase-label" className="lbl">Your recovery phrase</span>
            <output aria-labelledby="signup-phrase-label" className="n-md" style={{ display: "block", padding: 16, border: "2px solid var(--ink)", borderRadius: 12, background: "var(--surface)", fontSize: 24, lineHeight: "38px", overflowWrap: "anywhere" }}>{phrase}</output>
            <button type="button" className="btn btn-s btn-b" onClick={copy}>{copied === "ok" ? "Copied" : "Copy phrase"}</button>
            <p className={copied === "failed" ? "t-s c2" : "sr"} role="status">{copied === "ok" ? "Phrase copied." : copied === "failed" ? "Couldn't copy. Select the phrase and copy it." : ""}</p>
            <button type="button" className="btn btn-g" style={{ alignSelf: "flex-start", marginLeft: -10 }} onClick={() => { setOwnPhrase(true); setErrors({}); }}>Use my own phrase instead</button>
          </div>
        )}
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48 }}>
            <input id="signup-saved" type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} aria-invalid={errors.saved ? "true" : undefined} aria-describedby={errors.saved ? "signup-saved-err" : undefined} style={{ width: 24, height: 24, margin: 0, accentColor: "var(--ink)", flex: "none" }} />
            <span className="t-b">I saved it somewhere safe</span>
          </label>
          {errors.saved && <FieldError id="signup-saved-err">{errors.saved}</FieldError>}
        </div>
        <p className="t-s c2">You confirm with a tick, not by typing it back. You can change the phrase later in Settings, under Account.</p>
        {errors.form && <FormError>{errors.form}</FormError>}
      </main>
      <div className="foot"><button type="button" className="btn btn-p btn-lg btn-b" aria-disabled={busy || undefined} onClick={finish}>{busy ? "Creating your account…" : "Finish"}</button></div>
    </div>
  );
}

function Reset({ username, setUsername, onAuthed, onSignInAgain }) {
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const next = {
      username: username.trim() ? "" : "Enter your username.",
      phrase: phrase.trim().length >= 8 ? "" : "Enter the whole recovery phrase you saved.",
      password: passwordProblem(password),
    };
    setErrors(next);
    if (next.username || next.phrase || next.password) {
      focusFirst([next.username && "reset-username", next.phrase && "reset-phrase", next.password && "reset-password"]);
      return;
    }
    setBusy(true);
    const res = await resetPasswordWithRecovery({ username: username.trim(), recoveryPhrase: phrase.trim(), newPassword: password });
    if (res.error) { setBusy(false); setErrors({ form: res.error }); return; }
    // The new password works now, so sign straight in.
    const login = await logIn({ username: username.trim(), password });
    setBusy(false);
    if (login.error) { onSignInAgain(res.message || "Password reset. Sign in with your new password."); return; }
    onAuthed(login.user);
  };

  return (
    <div className="shell">
      <TopBar title="Reset password" back="Sign in" onBack={() => go("#signin")} />
      <main className="main" style={{ gap: 16, paddingTop: 12 }}>
        <p className="t-b c2">Enter your username and the recovery phrase you saved when you signed up. Paste works in every field.</p>
        <form id="reset-form" noValidate onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <TextField id="reset-username" label="Username" autoComplete="username" value={username} onChange={setUsername} error={errors.username} />
          <TextField id="reset-phrase" label="Recovery phrase" autoComplete="off" mono value={phrase} onChange={setPhrase} error={errors.phrase} />
          <PasswordField id="reset-password" label="New password" hint={PASSWORD_RULE} autoComplete="new-password" value={password} onChange={setPassword} error={errors.password} />
          {errors.form && <FormError>{errors.form}</FormError>}
        </form>
      </main>
      <div className="foot"><button type="submit" form="reset-form" className="btn btn-p btn-lg btn-b" aria-disabled={busy || undefined}>{busy ? "Resetting…" : "Reset and sign in"}</button></div>
    </div>
  );
}

export default function AuthScreen({ onAuthed }) {
  const [view, setView] = useState(viewFromHash);
  const [signup, setSignup] = useState({ known: false, open: false });
  const [username, setUsername] = useState("");
  const [notice, setNotice] = useState("");
  const shownView = useRef(view);

  useEffect(() => {
    let active = true;
    getSignupStatus()
      .then(({ open }) => { if (active) setSignup({ known: true, open: Boolean(open) }); })
      .catch(() => { if (active) setSignup({ known: true, open: false }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // A new screen starts at the top. Focus goes to its Back button when it has
  // one, as on every screen one level down, and otherwise to its title, so a
  // screen reader says where you are. The first screen leaves focus alone.
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    window.scrollTo(0, 0);
    (document.querySelector(".ot .top .back") || document.querySelector(".ot h1"))?.focus({ preventScroll: true });
  }, [view]);

  const signInAgain = (message) => { setNotice(message); go("#signin"); };

  let screen;
  if (view === "signin") screen = <SignIn username={username} setUsername={setUsername} notice={notice} signupOpen={signup.open || !signup.known} onAuthed={onAuthed} />;
  else if (view === "signup") screen = signup.known && !signup.open ? <SignupClosed /> : <SignUp username={username} setUsername={setUsername} onAuthed={onAuthed} />;
  else if (view === "reset") screen = <Reset username={username} setUsername={setUsername} onAuthed={onAuthed} onSignInAgain={signInAgain} />;
  else screen = <LandingPage />;

  return <div className="ot" data-screen={`auth-${view}`}>{screen}</div>;
}
