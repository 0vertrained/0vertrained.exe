// The account context: what the app can read (status, user) and do
// (sign in, create, reset, sign out, delete). Methods resolve to a result
// rather than throwing, with the message already in plain copy, so a sheet
// shows it as is. The provider in AuthProvider.tsx fills this.
import { createContext } from "react";
import type { AuthClient } from "./authTypes";

export type AuthStatus = "loading" | "signed-out" | "signed-in" | "unavailable";

export interface AuthUser {
  id: string;
  username: string;
}

export type AuthResult = { ok: true; error?: undefined } | { ok: false; error: string };

export interface SignInInput {
  username: string;
  password: string;
}

export interface SignUpInput {
  username: string;
  password: string;
  recoveryPhrase: string;
  captchaToken?: string;
}

export interface ResetInput {
  username: string;
  recoveryPhrase: string;
  newPassword: string;
  captchaToken?: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** The loaded client, for sync code; null until a session is found or a method runs. */
  client: AuthClient | null;
  /** The last failed call's message; cleared by the next success. */
  error?: string;
  signIn(input: SignInInput): Promise<AuthResult>;
  signUp(input: SignUpInput): Promise<AuthResult>;
  signOut(): Promise<void>;
  resetWithRecovery(input: ResetInput): Promise<AuthResult>;
  deleteAccount(): Promise<AuthResult>;
  /** true when taken, false when free, null when it could not be checked. */
  isUsernameTaken(username: string): Promise<boolean | null>;
  /** Replaces the signed-in user's recovery phrase. */
  setRecoveryPhrase(phrase: string): Promise<AuthResult>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
