// The account sheet: one Sheet (id "auth") that is signing in, creating an
// account or resetting a password, switched by the ghost under the primary
// and the "Forgot password" link. Each mode owns its fields; the caller
// learns only that a session now exists and how it came to be.
import { useState } from "react";
import type { AuthMode } from "./AuthFrame";
import { CreateForm } from "./CreateForm";
import { ForgotForm } from "./ForgotForm";
import { SignInForm } from "./SignInForm";

export type { AuthMode } from "./AuthFrame";
export type SignedInMode = "signed-in" | "signed-up";

export interface AuthSheetProps {
  onClose: () => void;
  /** "signed-up" after Create account; "signed-in" after Sign in or a reset. */
  onSignedIn: (mode: SignedInMode) => void;
  initialMode?: AuthMode;
}

export function AuthSheet({ onClose, onSignedIn, initialMode = "sign-in" }: AuthSheetProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  if (mode === "create") return <CreateForm onClose={onClose} onMode={setMode} onSignedIn={() => onSignedIn("signed-up")} />;
  if (mode === "forgot") return <ForgotForm onClose={onClose} onMode={setMode} onSignedIn={() => onSignedIn("signed-in")} />;
  return <SignInForm onClose={onClose} onMode={setMode} onSignedIn={() => onSignedIn("signed-in")} />;
}
