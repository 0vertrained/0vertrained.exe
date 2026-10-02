import { createClient } from "@supabase/supabase-js";

// These come from environment variables — never hardcode keys in source.
// In Vite, client-exposed vars must be prefixed with VITE_.
// The anon key is safe to expose to the browser BECAUSE Row Level Security
// enforces that a logged-in user can only ever read/write their own rows.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const missingConfig = !supabaseUrl || !supabaseAnonKey;
const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

if (missingConfig && !demoMode) {
  // Visible, early failure so misconfiguration is obvious during setup.
  console.error(
    "Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

const createMockSupabase = () => {
  const chain = {
    select: () => chain, order: () => chain, range: () => Promise.resolve({ data: [], error: null }),
    gte: () => chain, limit: () => chain, single: () => Promise.resolve({ data: null, error: { code: "PGRST116" } }),
    eq: () => chain, update: () => Promise.resolve({ data: null, error: null }),
    upsert: () => Promise.resolve({ data: null, error: null }), delete: () => chain, neq: () => Promise.resolve({ data: null, error: null }),
  };
  return {
    auth: {
      onAuthStateChange: (cb) => { setTimeout(() => cb("INITIAL_SESSION", null), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      getUser: async () => ({ data: { user: null } }),
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: null, error: { message: "Demo mode: Supabase disabled" } }),
      signUp: async () => ({ data: null, error: { message: "Demo mode: Supabase disabled" } }),
    },
    from: () => chain,
    rpc: async () => ({ data: [], error: null }),
  };
};

export const supabase = missingConfig ? createMockSupabase() : createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // No email flows — we use username mapped to a synthetic internal address.
    detectSessionInUrl: false,
  },
});

// Usernames are mapped to a synthetic, non-routable internal address.
// This is NOT a real email and is never used to contact anyone — it only
// satisfies the auth system's internal identifier format. No PII stored.
//
// V14 · The domain is env-configurable. `athlete.app` is a REGISTRABLE domain
// this project does not control: if Supabase email features (confirmations,
// magic links, email reset) were ever enabled, whoever owns that domain's MX
// would receive credential mail for every account, and GoTrue's public
// recover endpoint can be invoked with just the anon key. The safe end state
// is a domain you control. Flipping VITE_AUTH_EMAIL_DOMAIN must happen in the
// SAME deploy as running scripts/migrate-auth-domain.mjs against auth.users —
// login derives this exact string, so the client constant and the stored
// emails have to move together. Until the flip, behavior is unchanged.
const AUTH_EMAIL_DOMAIN =
  (import.meta.env?.VITE_AUTH_EMAIL_DOMAIN || "").trim().toLowerCase() || "athlete.app";

export function usernameToInternalId(username) {
  const clean = String(username).trim().toLowerCase();
  return `${clean}@${AUTH_EMAIL_DOMAIN}`;
}
