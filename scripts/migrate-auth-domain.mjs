#!/usr/bin/env node
// scripts/migrate-auth-domain.mjs
//
// Move every auth.users synthetic email from the legacy domain
// (athlete.app — a registrable domain this project does not control) to a
// domain you own. Login derives `username@<domain>` client-side, so this
// script and the VITE_AUTH_EMAIL_DOMAIN build flip MUST land together:
//
//   1. Set VITE_AUTH_EMAIL_DOMAIN=<new domain> in the Netlify build env.
//   2. Run this script (dry-run first) against production.
//   3. Trigger the deploy.
//
//   Order 2→3 means users can't log in between the script finishing and the
//   deploy going live (minutes, beta-sized population). Announce it.
//
// Usage:
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
//   node scripts/migrate-auth-domain.mjs --domain ids.example.com [--from athlete.app] [--apply]
//
// Without --apply this is a DRY RUN: it prints what would change and exits.
// Idempotent: users already on the target domain are skipped, so re-running
// after a partial failure completes the remainder.

const args = process.argv.slice(2);
const getFlag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const APPLY = args.includes("--apply");
const NEW_DOMAIN = (getFlag("domain") || "").trim().toLowerCase();
const OLD_DOMAIN = (getFlag("from") || "athlete.app").trim().toLowerCase();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in the environment.");
  process.exit(1);
}
if (!NEW_DOMAIN || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(NEW_DOMAIN)) {
  console.error("--domain <domain-you-control> is required (e.g. --domain ids.example.com).");
  process.exit(1);
}
if (NEW_DOMAIN === OLD_DOMAIN) {
  console.error("--domain matches --from; nothing to do.");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "content-type": "application/json",
};

async function listAllUsers() {
  const users = [];
  let page = 1;
  for (;;) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!r.ok) throw new Error(`admin list users failed: ${r.status}`);
    const body = await r.json();
    const batch = body?.users || [];
    users.push(...batch);
    if (batch.length < 200) return users;
    page += 1;
  }
}

async function updateEmail(userId, email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers,
    // email_confirm keeps GoTrue from putting the account into a
    // pending-confirmation state over a synthetic address.
    body: JSON.stringify({ email, email_confirm: true }),
  });
  return r.ok;
}

const users = await listAllUsers();
const targets = users.filter((u) => (u.email || "").toLowerCase().endsWith(`@${OLD_DOMAIN}`));
const already = users.filter((u) => (u.email || "").toLowerCase().endsWith(`@${NEW_DOMAIN}`)).length;

console.log(`Found ${users.length} auth users · ${targets.length} on @${OLD_DOMAIN} · ${already} already on @${NEW_DOMAIN}`);

if (!targets.length) {
  console.log("Nothing to migrate.");
  process.exit(0);
}

let ok = 0, failed = 0;
for (const user of targets) {
  const localPart = user.email.slice(0, user.email.lastIndexOf("@"));
  const newEmail = `${localPart}@${NEW_DOMAIN}`;
  if (!APPLY) {
    console.log(`[dry-run] ${user.email} → ${newEmail}`);
    continue;
  }
  const success = await updateEmail(user.id, newEmail);
  if (success) { ok += 1; console.log(`✓ ${user.email} → ${newEmail}`); }
  else { failed += 1; console.error(`✗ FAILED ${user.email} → ${newEmail}`); }
}

if (!APPLY) {
  console.log(`\nDry run complete — ${targets.length} users would be migrated. Re-run with --apply to execute.`);
} else {
  console.log(`\nDone: ${ok} migrated, ${failed} failed.${failed ? " Re-run to retry failures (idempotent)." : ""}`);
  process.exit(failed ? 1 : 0);
}
