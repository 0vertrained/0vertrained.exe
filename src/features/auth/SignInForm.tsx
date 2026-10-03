// Sign in: username and password, the primary "Sign in", a ghost to create
// an account and a text link into the recovery flow. Empty fields are
// caught inline; the server's answer shows as a notice.
import { useState } from "react";
import { sanitizeUsername } from "../../auth/auth";
import { AUTH_COPY } from "../../auth/authErrors";
import { useAuth } from "../../auth/useAuth";
import { Button } from "../../design/Button";
import { TextInput } from "../../design/TextInput";
import { AuthFrame, enterSubmits, type AuthMode, type FormErrors } from "./AuthFrame";
import styles from "./AuthSheet.module.css";

export interface AuthFormProps {
  onClose: () => void;
  onMode: (mode: AuthMode) => void;
  onSignedIn: () => void;
}

export function SignInForm({ onClose, onMode, onSignedIn }: AuthFormProps) {
  const auth = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const name = sanitizeUsername(username);
    const next: FormErrors = { username: name ? undefined : AUTH_COPY.enterUsername, password: password ? undefined : AUTH_COPY.enterPassword };
    if (next.username || next.password) {
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await auth.signIn({ username: name, password });
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
      title="Sign in"
      onClose={onClose}
      error={errors.form}
      footer={
        <>
          <Button variant="primary" full loading={busy} onClick={() => void submit()}>Sign in</Button>
          <Button variant="ghost" full onClick={() => onMode("create")}>Create account</Button>
        </>
      }
    >
      <TextInput id="auth-username" label="Username" value={username} autoComplete="username" error={errors.username} onChange={(v) => setUsername(sanitizeUsername(v))} onKeyDown={onKey} />
      <TextInput id="auth-password" label="Password" type="password" value={password} autoComplete="current-password" error={errors.password} onChange={setPassword} onKeyDown={onKey} />
      <p className={`ot-small ${styles.line}`}>
        <button type="button" className="ot-link" onClick={() => onMode("forgot")}>Forgot password</button>
      </p>
    </AuthFrame>
  );
}
