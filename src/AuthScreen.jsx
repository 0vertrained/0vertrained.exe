// src/AuthScreen.jsx
// Public landing + private beta authentication, including a complete
// server-verified recovery-phrase reset flow.
import { useState, useEffect } from "react";
import { useTheme } from "./theme";
import { useIsDesktop } from "./ui/useMediaQuery";
// GetSignupStatus was dynamically imported below while this module
// already statically imports "./auth" — Vite flagged it: the dynamic import
// could never split a chunk and was pure overhead. One static import now.
import { signUp, logIn, resetPasswordWithRecovery, getSignupStatus } from "./auth";
import { buildSupportMailto } from "./appMeta";
import LandingPage, { Wordmark } from "./landing/LandingPage";

export default function AuthScreen({ onAuthed }) {
  const { C, S } = useTheme();
  const isDesktop = useIsDesktop();
  const [mode, setMode] = useState("login"); // login | signup | recovery
  const [signupAvailable, setSignupAvailable] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovery, setRecovery] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [userCount, setUserCount] = useState({ current: 0, max: 5 });

  useEffect(() => {
    let active = true;
    getSignupStatus().then(({ open, current, max }) => {
      if (!active) return;
      setSignupAvailable(open);
      setUserCount({ current, max });
      setMode(open ? "signup" : "login");
    });
    return () => { active = false; };
  }, []);

  // The auth card may mount after a landing demo closes while the hash already
  // equals #signin. Resolve that delayed anchor explicitly.
  useEffect(() => {
    if (window.location.hash !== "#signin") return;
    requestAnimationFrame(() => document.getElementById("signin")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [mode]);

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setNotice("");
    setPassword("");
    setConfirm("");
    setRecovery("");
    setRecoveryConfirm("");
  };

  const submit = async (event) => {
    event?.preventDefault();
    setError("");
    setNotice("");
    const cleanUsername = username.trim();
    if (!cleanUsername) { setError("Username required."); return; }

    if (mode === "recovery") {
      if (!recovery.trim() || recovery.trim().length < 8) { setError("Enter your recovery phrase."); return; }
      if (password.length < 8 || !/[^a-zA-Z]/.test(password)) { setError("Use an 8+ character password with at least one number or symbol."); return; }
      if (password !== confirm) { setError("Passwords do not match."); return; }
      setBusy(true);
      const res = await resetPasswordWithRecovery({
        username: cleanUsername,
        recoveryPhrase: recovery.trim(),
        newPassword: password,
      });
      setBusy(false);
      if (res.error) { setError(res.error); return; }
      changeMode("login");
      setNotice(res.message || "Password reset. You can sign in now.");
      return;
    }

    if (!password) { setError("Password required."); return; }
    setBusy(true);
    if (mode === "signup") {
      if (password.length < 8) { setError("Password must be at least 8 characters."); setBusy(false); return; }
      if (password !== confirm) { setError("Passwords do not match."); setBusy(false); return; }
      if (!recovery.trim() || recovery.trim().length < 8) { setError("Set a recovery phrase (8+ chars)."); setBusy(false); return; }
      if (recovery.trim() !== recoveryConfirm.trim()) { setError("Recovery phrases do not match."); setBusy(false); return; }
      const res = await signUp({ username: cleanUsername, password, recoveryPhrase: recovery.trim() });
      setBusy(false);
      if (res.error) { setError(res.error); return; }
      onAuthed(res.user);
    } else {
      const res = await logIn({ username: cleanUsername, password });
      setBusy(false);
      if (res.error) { setError(res.error); return; }
      onAuthed(res.user);
    }
  };

  const authCardStyle = {
    width: "100%",
    maxWidth: 430,
    padding: "22px 20px",
    border: `1px solid ${C.line}`,
    background: C.panel,
    boxSizing: "border-box",
  };
  const primaryBtn = { ...S.authBtn, background: C.text, color: C.bg, border: `1px solid ${C.text}` };
  const authTitle = mode === "signup" ? "Create 0VERTRAINED account" : mode === "recovery" ? "Recover 0VERTRAINED account" : "Sign in to 0VERTRAINED";
  const eyebrow = mode === "signup" ? "Beta access" : mode === "recovery" ? "Account recovery" : "Private login";
  const heading = mode === "signup" ? "Create Account" : mode === "recovery" ? "Reset Password" : "Sign In";

  return (
    <main style={{ ...S.app, width: "100%", maxWidth: 1180, minHeight: "100dvh", padding: "clamp(20px, 4vw, 46px)", display: "grid", gridTemplateColumns: isDesktop ? "minmax(0, 1.55fr) minmax(0, 1fr)" : "minmax(0, 1fr)", gap: "clamp(26px, 5vw, 58px)", alignItems: "start" }}>
      <LandingPage />

      <section id="signin" aria-label={authTitle} style={{ position: isDesktop ? "sticky" : "static", top: 24, alignSelf: "start", scrollMarginTop: 18 }}>
        <form style={authCardStyle} onSubmit={submit}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, borderBottom: `1px solid ${C.line}`, paddingBottom: 12, marginBottom: 18 }}>
            {S.isSerif ? <Wordmark size={21} compact /> : <div style={S.authTitle}>Hybrid Athlete</div>}
            <div style={{ fontFamily: C.monoFamily, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>{eyebrow}</div>
          </div>

          <div style={{ ...S.authSub, marginTop: 0 }}>{heading}</div>

          <label htmlFor="auth-username" style={S.authLabel}>Username</label>
          <input id="auth-username" style={S.authInput} autoCapitalize="none" autoCorrect="off" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />

          {mode === "recovery" && (
            <>
              <label htmlFor="auth-recovery" style={S.authLabel}>Recovery Phrase</label>
              <input id="auth-recovery" style={S.authInput} autoComplete="off" value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="the phrase you stored" />
            </>
          )}

          <label htmlFor="auth-password" style={S.authLabel}>{mode === "recovery" ? "New Password" : "Password"}</label>
          <input id="auth-password" style={S.authInput} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />

          {(mode === "signup" || mode === "recovery") && (
            <>
              <label htmlFor="auth-confirm" style={S.authLabel}>Confirm {mode === "recovery" ? "New " : ""}Password</label>
              <input id="auth-confirm" style={S.authInput} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
            </>
          )}

          {mode === "signup" && (
            <>
              <label htmlFor="auth-recovery" style={S.authLabel}>Recovery Phrase</label>
              <input id="auth-recovery" style={S.authInput} value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="a phrase only you know" />
              <label htmlFor="auth-recovery-confirm" style={S.authLabel}>Confirm Recovery Phrase</label>
              <input id="auth-recovery-confirm" style={S.authInput} value={recoveryConfirm} onChange={(e) => setRecoveryConfirm(e.target.value)} placeholder="type it again exactly" />
              <div style={S.authNote}>
                // This phrase is your way back in if you forget your password.<br />
                // Store it somewhere safe and private. It is hashed, never saved as plain text.
              </div>
            </>
          )}

          {error && <div style={S.authError} role="alert">{error}</div>}
          {notice && <div style={{ ...S.authNote, color: C.text, borderLeft: `2px solid ${C.text}`, paddingLeft: 10 }} role="status">{notice}</div>}

          <button type="submit" style={primaryBtn} disabled={busy}>
            {busy ? "..." : mode === "signup" ? "Create Account" : mode === "recovery" ? "Reset Password" : "Sign In"}
          </button>

          {mode === "login" && (
            <button type="button" style={S.authToggle} onClick={() => changeMode("recovery")}>› Forgot password?</button>
          )}
          {mode === "recovery" && (
            <button type="button" style={S.authToggle} onClick={() => changeMode("login")}>› Back to sign in</button>
          )}
          {signupAvailable && mode !== "recovery" && (
            <button type="button" style={S.authToggle} onClick={() => changeMode(mode === "signup" ? "login" : "signup")}>
              {mode === "signup" ? "› Already have an account? Sign in" : "› Need to create your account? Sign up"}
            </button>
          )}

          {!signupAvailable && mode === "login" && (
            <div style={S.authNote}>
              Signup is full ({userCount.current}/{userCount.max} users).{" "}
              <a href={buildSupportMailto({ subject: "0VERTRAINED beta access" })} style={{ color: C.text, textDecoration: "underline" }}>Contact Rami for access.</a>
            </div>
          )}
          {signupAvailable && mode === "login" && <div style={S.authNote}>{userCount.current}/{userCount.max} accounts active</div>}
        </form>
      </section>
    </main>
  );
}
