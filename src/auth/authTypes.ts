// The slice of the Supabase client that accounts use, written as plain
// structural types. The provider and the sheet program against this, so
// tests inject a fake without supabase-js in the bundle, and the real
// client from createClient() satisfies it (supabaseClient.ts proves that
// at compile time). Keep it minimal: add a method here only when the
// account code calls it.

export interface AuthErrorLike {
  message: string;
  name?: string;
  status?: number | undefined;
  code?: string | undefined;
}

/** The server's user record; only the fields the app reads. */
export interface AuthUserRecord {
  id: string;
  email?: string | undefined;
  user_metadata?: Record<string, unknown> | undefined;
}

export interface AuthSession {
  user: AuthUserRecord;
  /** The JWT, attached to error reports; present on a real session. */
  access_token?: string;
}

export interface AuthSignUpInput {
  email: string;
  password: string;
  options?: {
    /** Stored as user metadata; the server reads `username` to create the profile. */
    data?: Record<string, unknown>;
    captchaToken?: string;
  };
}

export interface AuthSignInInput {
  email: string;
  password: string;
  options?: { captchaToken?: string };
}

export interface AuthSessionResponse {
  data: { user: AuthUserRecord | null; session: AuthSession | null };
  error: AuthErrorLike | null;
}

export type AuthStateCallback = (event: string, session: AuthSession | null) => void;

export interface AuthSubscription {
  unsubscribe: () => void;
}

export interface AuthApi {
  signUp(input: AuthSignUpInput): Promise<AuthSessionResponse>;
  signInWithPassword(input: AuthSignInInput): Promise<AuthSessionResponse>;
  signOut(): Promise<{ error: AuthErrorLike | null }>;
  getSession(): Promise<{ data: { session: AuthSession | null }; error: AuthErrorLike | null }>;
  getUser(): Promise<{ data: { user: AuthUserRecord | null }; error: AuthErrorLike | null }>;
  onAuthStateChange(callback: AuthStateCallback): { data: { subscription: AuthSubscription } };
}

export interface RpcResult {
  data: unknown;
  error: AuthErrorLike | null;
}

export interface AuthClient {
  auth: AuthApi;
  /** A Postgres function call; the real client returns a thenable builder, hence PromiseLike. */
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
}
