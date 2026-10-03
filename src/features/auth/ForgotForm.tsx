// Reset password with the recovery phrase: username, the phrase as a
// multiline field (pasting is fine; spacing and case are normalised), and
// the new password. A success signs the user straight in.
import { useRef, useState } from "react";
import { normalizePhrase, PASSWORD_RULE, sanitizeUsername, validatePassword } from "../../auth/auth";
import { AUTH_COPY } from "../../auth/authErrors";
import { useAuth } from "../../auth/useAuth";
import { Button } from "../../design/Button";
import { TextInput } from "../../design/TextInput";
import { AuthFrame, enterSubmits, type FormErrors } from "./AuthFrame";
import styles from "./AuthSheet.module.css";
import { CAPTCHA_NEEDED } from "./CreateForm";
import type { AuthFormProps } from "./SignInForm";
import { useTurnstile } from "./useTurnstile";

export function ForgotForm({ onClose, onMode, onSignedIn }: AuthFormProps) {
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const captchaRef = useRef<HTMLDivElement>(null);
  const captcha = useTurnstile(true, captchaRef);

  const submit = async () => {
    if (busy) return;
    const name = sanitizeUsername(username);
    const next: FormErrors = {
      username: name ? undefined : AUTH_COPY.enterUsername,
      phrase: normalizePhrase(phrase) ? undefined : AUTH_COPY.enterPhrase,
      password: validatePassword(password) ?? undefined,
    };
    if (next.username || next.phrase || next.password) {
      setErrors(next);
      return;
    }
    if (captcha.required && !captcha.token) {
      setErrors({ form: CAPTCHA_NEEDED });
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await auth.resetWithRecovery({ username: name, recoveryPhrase: phrase, newPassword: password, ...(captcha.token ? { captchaToken: captcha.token } : {}) });
    if (result.ok) {
      onSignedIn();
      return;
    }
    setBusy(false);
    setErrors({ form: result.error });
  };
  const onKey = enterSubmits(() => void submit());

  return (
    <AuthFrame
      title="Reset password"
      onClose={onClose}
      error={errors.form}
      footer={
        <>
          <Button variant="primary" full loading={busy} disabled={captcha.required && !captcha.token} onClick={() => void submit()}>Reset password</Button>
          <Button variant="ghost" full onClick={() => onMode("sign-in")}>Sign in instead</Button>
        </>
      }
    >
      <TextInput id="auth-username" label="Username" value={username} autoComplete="username" error={errors.username} onChange={(v) => setUsername(sanitizeUsername(v))} onKeyDown={onKey} />
      <TextInput id="auth-phrase" label="Recovery phrase" multiline value={phrase} autoComplete="off" hint="The phrase you saved when you created the account." error={errors.phrase} onChange={setPhrase} onKeyDown={onKey} />
      <TextInput id="auth-new-password" label="New password" type="password" value={password} autoComplete="new-password" hint={PASSWORD_RULE} error={errors.password} onChange={setPassword} onKeyDown={onKey} />
      {captcha.required ? <div ref={captchaRef} className={styles.captcha} /> : null}
    </AuthFrame>
  );
}
