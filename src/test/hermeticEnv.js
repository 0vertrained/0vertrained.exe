// Tests run without the deploy's configuration. Netlify passes every site
// environment variable to the build command — including `npm test` — and a
// local .env reaches Vitest the same way, so without this a test's outcome
// depended on which real keys happened to be set (a configured Supabase URL
// even swapped the mock client for a live one). Each test sets the variables
// it needs; everything the app reads starts out unset.
const APP_ENV = /^(VITE_|SUPABASE_|TOKEN_ENCRYPTION_KEY$|CONNECTED_ACCOUNT_ENCRYPTION_KEY$|OURA_|WHOOP_|STRAVA_|GOOGLE_HEALTH_|VAPID_|OLLAMA_|COACH_|FORM_CHECK_|LOG_ERROR_|LOG_EVENT_)/;

for (const key of Object.keys(process.env)) {
  if (APP_ENV.test(key)) delete process.env[key];
}
for (const key of Object.keys(import.meta.env)) {
  if (APP_ENV.test(key)) delete import.meta.env[key];
}
