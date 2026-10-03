// A test double for AuthClient with the server's contract in miniature:
// usernames come from the email's local part, a taken username fails
// sign-up with a message that names "username", and the three RPCs the app
// calls are answered from memory. Every call is logged for assertions.
// Test-only; nothing in the app imports it.
import type { AuthClient, AuthSession, AuthSignInInput, AuthSignUpInput, AuthStateCallback, AuthUserRecord, RpcResult } from "./authTypes";

export interface FakeAccount {
  password: string;
  phrase?: { hash: string; salt: string; kdf: string };
}

export interface FakeAuthOptions {
  /** Existing accounts by username. */
  accounts?: Record<string, string>;
  /** The session already stored (a returning user). */
  session?: AuthSession | null;
  /** Reject every network call with a fetch failure. */
  offline?: boolean;
}

export interface FakeAuthClient extends AuthClient {
  accounts: Map<string, FakeAccount>;
  session: AuthSession | null;
  calls: { signUp: AuthSignUpInput[]; signIn: AuthSignInInput[]; signOut: number; rpc: Array<{ fn: string; args: Record<string, unknown> | undefined }> };
  /** Fires an auth event as the real client would. */
  emit(event: string, session: AuthSession | null): void;
}

const localPart = (email: string): string => email.split("@")[0] ?? "";

export function createFakeAuthClient(options: FakeAuthOptions = {}): FakeAuthClient {
  const accounts = new Map<string, FakeAccount>(Object.entries(options.accounts ?? {}).map(([name, password]) => [name, { password }]));
  const listeners = new Set<AuthStateCallback>();
  let nextId = 1;
  const offline = (): never => {
    throw new TypeError("Failed to fetch");
  };
  const userFor = (name: string, email: string): AuthUserRecord => ({ id: `user-${name}`, email, user_metadata: { username: name } });

  const client: FakeAuthClient = {
    accounts,
    session: options.session ?? null,
    calls: { signUp: [], signIn: [], signOut: 0, rpc: [] },
    emit(event, session) {
      for (const cb of listeners) cb(event, session);
    },
    auth: {
      async signUp(input) {
        client.calls.signUp.push(input);
        if (options.offline) offline();
        const name = localPart(input.email);
        if (accounts.has(name)) return { data: { user: null, session: null }, error: { message: "A profile with this username already exists", status: 422 } };
        accounts.set(name, { password: input.password });
        const user = { ...userFor(name, input.email), id: `user-${nextId++}` };
        client.session = { user };
        client.emit("SIGNED_IN", client.session);
        return { data: { user, session: client.session }, error: null };
      },
      async signInWithPassword(input) {
        client.calls.signIn.push(input);
        if (options.offline) offline();
        const name = localPart(input.email);
        const account = accounts.get(name);
        if (!account || account.password !== input.password) return { data: { user: null, session: null }, error: { message: "Invalid login credentials", status: 400 } };
        client.session = { user: userFor(name, input.email) };
        client.emit("SIGNED_IN", client.session);
        return { data: { user: client.session.user, session: client.session }, error: null };
      },
      async signOut() {
        client.calls.signOut += 1;
        client.session = null;
        client.emit("SIGNED_OUT", null);
        return { error: null };
      },
      async getSession() {
        return { data: { session: client.session }, error: null };
      },
      async getUser() {
        return { data: { user: client.session?.user ?? null }, error: null };
      },
      onAuthStateChange(callback) {
        listeners.add(callback);
        queueMicrotask(() => {
          if (listeners.has(callback)) callback("INITIAL_SESSION", client.session);
        });
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      },
    },
    rpc(fn, args) {
      client.calls.rpc.push({ fn, args });
      const answer = (): RpcResult => {
        if (options.offline) offline();
        if (fn === "username_taken") return { data: accounts.has(String(args?.["p_username"] ?? "")), error: null };
        if (fn === "set_recovery_phrase") {
          const name = client.session?.user.user_metadata?.["username"];
          const account = typeof name === "string" ? accounts.get(name) : undefined;
          if (!account) return { data: null, error: { message: "Not signed in", status: 401 } };
          account.phrase = { hash: String(args?.["p_hash"]), salt: String(args?.["p_salt"]), kdf: String(args?.["p_kdf"]) };
          return { data: null, error: null };
        }
        if (fn === "delete_my_account") {
          const name = client.session?.user.user_metadata?.["username"];
          if (typeof name === "string") accounts.delete(name);
          return { data: null, error: null };
        }
        return { data: null, error: { message: `Unknown function ${fn}`, status: 404 } };
      };
      return Promise.resolve().then(answer);
    },
  };
  return client;
}
