// Runtime configuration for the v20 app, read once from the build-time env.
// Until cutover the new app uses VITE_NEXT_* names so the live v19 build's
// values never leak in. With no backend configured the app is guest-only.
const env = import.meta.env as Record<string, string | undefined>;

const clean = (v: string | undefined): string => (v ?? "").trim();

export const backendConfig = Object.freeze({
  supabaseUrl: clean(env["VITE_NEXT_SUPABASE_URL"]),
  supabaseAnonKey: clean(env["VITE_NEXT_SUPABASE_ANON_KEY"]),
  /** Accounts are username + password; Supabase needs an email, so one is synthesised on this domain. */
  authEmailDomain: clean(env["VITE_NEXT_AUTH_EMAIL_DOMAIN"]).toLowerCase() || "users.0vertrained.app",
  /** Cloudflare Turnstile site key; empty disables the widget (local dev, CI). */
  turnstileSiteKey: clean(env["VITE_NEXT_TURNSTILE_SITE_KEY"]),
  /** Where client error reports go during the strangler period. */
  errorEndpoint: "/api/next/log-error",
  recoveryEndpoint: "/api/next/account-recovery",
});

/** True when accounts and sync are available in this build. */
export function hasBackend(): boolean {
  return backendConfig.supabaseUrl.length > 0 && backendConfig.supabaseAnonKey.length > 0;
}

/** The project ref ("abcdefgh" in https://abcdefgh.supabase.co), for storage key names. */
export function projectRef(url = backendConfig.supabaseUrl): string {
  const m = /^https?:\/\/([a-z0-9-]+)\.supabase\.(?:co|in)\b/i.exec(url);
  return m?.[1]?.toLowerCase() ?? "local";
}
