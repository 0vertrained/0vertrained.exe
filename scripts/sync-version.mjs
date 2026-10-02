#!/usr/bin/env node
// V13.5 · Single-source the app version.
//
// Before this script, four places carried a version independently and had
// already drifted (package.json 13.4.0, appMeta.js "V13.4", sw.js cache name
// v13.4.0, release zip 13.4.1). A stale sw.js CACHE_NAME is the dangerous
// one: the service worker only busts its shell cache when that string
// changes, so drift means installed PWAs can keep serving an old shell after
// a real release.
//
// Now: package.json `version` is the only source. appMeta.js reads it via the
// Vite/Vitest `__APP_VERSION__` define; this script stamps public/sw.js. It
// runs automatically via the npm `prebuild` hook (both quality-gate builds)
// and can be run directly after a version bump: `npm run sync:version`.
// versionSync.test.js fails the gate whenever sw.js and package.json drift.

import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const swPath = new URL("../public/sw.js", import.meta.url);
const sw = readFileSync(swPath, "utf8");

const desired = `const CACHE_NAME = "ovt-shell-v${pkg.version}";`;
const stamped = sw.replace(/const CACHE_NAME = "ovt-shell-v[^"]*";/, desired);

if (!stamped.includes(desired)) {
  console.error("sync-version: could not find the CACHE_NAME line in public/sw.js");
  process.exit(1);
}

if (stamped !== sw) {
  writeFileSync(swPath, stamped);
  console.log(`sync-version: stamped public/sw.js → ovt-shell-v${pkg.version}`);
} else {
  console.log(`sync-version: public/sw.js already at ovt-shell-v${pkg.version}`);
}
