// Create account: the username is checked against the server on blur, the
// password rule sits under its field, and the generated recovery phrase is
// shown once in the mono with a Copy ghost. The Switch under it gates the
// primary: nothing is created until the phrase is confirmed saved.
import { useRef, useState } from "react";
import { PASSWORD_RULE, sanitizeUsername, USERNAME_RULE, validatePassword, validateUsername } from "../../auth/auth";
import { generateRecoveryPhrase } from "../../auth/recoveryWords";
import { AUTH_COPY } from "../../auth/authErrors";
import { useAuth } from "../../auth/useAuth";
import { Button } from "../../design/Button";
import { Panel } from "../../design/Panel";
import { Switch } from "../../design/Switch";
import { TextInput } from "../../design/TextInput";
import { AuthFrame, enterSubmits, type FormErrors } from "./AuthFrame";
import styles from "./AuthSheet.module.css";
import type { AuthFormProps } from "./SignInForm";
import { useTurnstile } from "./useTurnstile";

export const PHRASE_NOTE = "Write this down. It is the only way to reset your password.";
export const CAPTCHA_NEEDED = "Complete the check above, then try again.";

type CopyState = "idle" | "copied" | "unavailable";

export function CreateForm({ onClose, onMode, onSignedIn }: AuthFormProps) {
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phrase] = useState(() => generateRecoveryPhrase());
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<CopyState>("idle");
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const captchaRef = useRef<HTMLDivElement>(null);
  const captcha = useTurnstile(true, captchaRef);
  const check = useRef(0);

  const checkUsername = async () => {
    const name = sanitizeUsername(username);
    setUsername(name);
    const message = validateUsername(name);
    if (message) {
      setErrors((e) => ({ ...e, username: message }));
      return;
    }
    const id = ++check.current;
    const taken = await auth.isUsernameTaken(name);
    if (id !== check.current) return;
    setErrors((e) => ({ ...e, username: taken ? AUTH_COPY.usernameTaken : undefined }));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied("copied");
      window.setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("unavailable");
    }
  };

  const submit = async () => {
    if (busy || !saved) return;
    const name = sanitizeUsername(username);
    const next: FormErrors = { username: validateUsername(name) ?? undefined, password: validatePassword(password) ?? undefined };
    if (next.username || next.password) {
      setErrors(next);
      return;
    }
    if (captcha.required && !captcha.token) {
      setErrors({ form: CAPTCHA_NEEDED });
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await auth.signUp({ username: name, password, recoveryPhrase: phrase, ...(captcha.token ? { captchaToken: captcha.token } : {}) });
    if (result.ok) {
      onSignedIn();
      return;
    }
    setBusy(false);
    setErrors(result.error === AUTH_COPY.usernameTaken ? { username: result.error } : { form: result.error });
  };
  const onKey = enterSubmits(() => void submit());
  const blocked = !saved || (captcha.required && !captcha.token);

  return (
    <AuthFrame
      title="Create account"
      onClose={onClose}
      error={errors.form}
      footer={
        <>
          <Button variant="primary" full loading={busy} disabled={blocked} onClick={() => void submit()}>Create account</Button>
          <Button variant="ghost" full onClick={() => onMode("sign-in")}>Sign in instead</Button>
        </>
      }
    >
      <TextInput id="auth-username" label="Username" value={username} autoComplete="username" hint={USERNAME_RULE} error={errors.username} onChange={(v) => setUsername(sanitizeUsername(v))} onBlur={() => void checkUsername()} onKeyDown={onKey} />
      <TextInput id="auth-password" label="Password" type="password" value={password} autoComplete="new-password" hint={PASSWORD_RULE} error={errors.password} onChange={setPassword} onKeyDown={onKey} />
      <Panel sunken as="div" aria-label="Recovery phrase">
        <p className={`ot-numeral ${styles.phrase}`}>{phrase}</p>
        <div className={styles.phraseRow}>
          <p className={`ot-small ot-ink-2 ${styles.phraseNote}`}>{copied === "unavailable" ? "Copy is not available here. Write the phrase down." : PHRASE_NOTE}</p>
          <Button variant="ghost" size="sm" onClick={() => void copy()}>{copied === "copied" ? "Copied" : "Copy"}</Button>
        </div>
      </Panel>
      <Switch label="I have saved my recovery phrase" checked={saved} onChange={setSaved} />
      {captcha.required ? <div ref={captchaRef} className={styles.captcha} /> : null}
    </AuthFrame>
  );
}
