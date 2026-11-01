# 0VERTRAINED v19.4.0 — Front Door

The P0s from `APP_REVIEW_2026-10-22.md` (#1 the dead end, #2 the unrouted endpoints, #3 the privacy policy), #5 (wearable connections) and the quick wins. A separate reviewer then read the patch cold, four times.
- The first pass found that the new OAuth handling could write default settings over a real profile, and that it was skipped on some cached launches.
- The second pass checked those fixes and found what they had opened up: one account's settings could carry into the next after logout, a profile-less account could get stuck in setup, and a theme switch could be skipped.
- The third found the remaining ways for default settings to reach the cache or the server: a queued save behind the retry panel, Settings opened while the account was still loading, a sign-out from another tab, and a failed program read.
- The fourth tried to break the resulting rule, "nothing writes until the account is known". It found two screens that survived a sign-out from another tab: the export screen, which held the last account's history, and paste-import. Its verdict after those were fixed: ship. What's left is under Known nuances.

The answer to the third round was that one rule, rather than more patches. All of it is fixed here, along with the pre-existing launch bugs behind it (see "Launching when a read fails").

## What changed

### New accounts reach a logger (`src/dayZero.js`, `src/App.jsx`)
- Through v19.3 a brand-new account could never log anything. Each Day Zero sample replaces its whole tab, and Today and Fuel stayed samples until a workout or meal was logged, but the loggers live inside those tabs. Fuel's other way out read `settings.macroTargets`, which nothing writes.
- **Today and Fuel clear when setup finishes** (setup is where the program and targets are chosen), or on any logged workout or meal. In practice the samples now show only to an account that hasn't finished setup.
- **Recovery:** manual and "connect later" setups get the live manual view, as setup promises ("manual is first-class"). So do accounts onboarded before setup recorded an answer, since manual is the default. A "Wearable connected" setup keeps the sample until a wearable connects or a check-in is logged on Today.
- **Each sample's one action opens the step that clears it.** Today and Fuel open setup; Recovery's "Connect Oura" opens Settings → Integrations. All three opened Profile before.
- The samples still replace their whole tab. The review suggested a sample card above the live tab instead, but that would put a fake workout above the real one, against the V17 rule that a specimen never mixes with real data. Making each sample clearable fixes the dead end without that.
- After setup, the first set takes three taps, not the two the review promised: open the day's workout, start the session, bank the set once the weight and reps are in. The day's main button asks for the morning check-in first; that's the existing design and I left it alone.
- **Sunday Edition** read the same dead key for fuel targets. It now reads `settings.goals` (what Fuel shows), so protein adherence appears.

### Setup saves are checked (`handleTutorialComplete`)
- Finish now waits for the program and settings saves. The results used to be ignored: a failed save closed the wizard as if all was well, and it came back on the next launch.
- If a save fails, the wizard stays on its last step with "Setup didn't save. Check your connection and tap Finish again." Finish retries.
- Settings (which carry the onboarded flag) save only after the program does, so a half-saved setup never marks the account set up.
- Setup's own fields (`setup`, `onboarded`, `goals`, `programBuilder`) are merged into the stored profile on the server (new `patchSettings` in `data.js`). Before, the device's whole settings object was saved, so a device holding stale or default settings would overwrite the rest of the profile.

### Launching when a read fails (`App.jsx` boot, `data.js`)
- `loadSettings()` and `loadProgram()` answer the defaults when the server can't be reached, which looks exactly like a brand-new account. Opening the app offline therefore:
  - put the setup wizard in front of an existing athlete,
  - swapped their program for the default one, and
  - wrote both into the cache.
- With v19.4's wizard staying open until setup saves, an offline athlete would have been stuck in it.
- New `loadSettingsChecked()` and `loadProgramChecked()` give the same answers plus an `error` when the read failed (and `missing` when there's no profile row). A missing program row still means a new account. The old functions behave exactly as before.
- At launch, a failed read keeps this account's cached settings and program, with no wizard. The next launch reads again. It never falls back to what's in memory, which can belong to another account.
- **When there's nothing trustworthy to show, the app says so.** That's a failed settings or program read with nothing cached, or an account with no profile row (a signup that never finished, e.g. at the user cap). The tabs and Profile show "Couldn't reach your account" (or "Your account isn't set up yet") with Try again, and Log out on Profile. Otherwise setup and the Day Zero samples would run off default settings, Today would show (and cache) the default plan as the athlete's, and any settings or program save would write those defaults over the account. A pending OAuth return waits for a successful retry.
- **Nothing writes until the account is known** (`accountReady`: loaded from a successful read or from this account's own cache). Until then:
  - Edits and queued saves don't touch the cache. Queued days wait in their own store and flush once the account loads. Coming back online still sends them, because they're this account's data.
  - Profile shows "Loading your account…" and Settings can't open. That window existed on every uncached launch before this release.
  - A cache with no settings in it doesn't count, so the launch shows the skeleton instead of painting from defaults.
- **Any sign-out clears the last account from the page.** That covers Log out and also being signed out from another tab. It clears the account's settings, username, in-memory save queue and pending save timers, and closes Settings, Profile, Coach and the export and import screens. The export screen holds the whole history, so the next account would have seen it. The queue is kept under that account's own key and flushes when it signs back in.
  - Before, a second account signing in on the same page could inherit the first one's settings, and the first account's unsent days could be saved into the second account.
  - The next sign-in starts on Today.
- The launch effect no longer depends on the theme. When the saved theme differed from the phone's light/dark setting, the cached launch switched themes, which cancelled the fresh load. That left the data stale, the "Refreshing latest data in background…" bar stuck, and (in this release) the OAuth return unhandled. In demo mode it also rebuilt the demo data on every theme change.
- The fresh load now always applies the server's theme. Before, it compared against the theme at launch, which is stale once the cached paint has switched. So a phone that cached dark could stay dark after the account was switched back to light elsewhere.

### Analytics, crash reports and push subscriptions reach their functions
- `log-event.js`, `log-error.js` and `push-subscribe.js` now declare `config.path` (`/api/log-event`, `/api/log-error`, `/api/push-subscribe`), the same pattern as `coach.js`. The client has always posted to those paths, and without a path they never reached the functions. The `events`, `client_errors` and `push_subscriptions` tables stayed empty: no funnel, no crash reports (the error screen says the error was "reported automatically"), and no subscribers for The Courier or the 7 pm reminder.
- `netlify.toml` is untouched.
- New `netlify/tests/api-routes.test.js` checks every `/api/…` path in `src/` against the declared function paths and the `netlify.toml` redirects. Run against the v19.3 tree, it names exactly these three.
- **Existing push subscribers re-register.** A device that turned notifications on before this release holds a subscription the server never stored: the card says "On" and nothing arrives. Once the account loads, a device with permission granted sends its subscription again (`resyncPushSubscription` in `push.js`), once per launch. It's an upsert on the endpoint and sends no preference fields, so stored preferences are kept. Only devices with permission granted load the push module.

### Wearable connections finish in the app (`src/oauthReturn.js`)
- The OAuth callbacks return with the result in the URL (`/settings?oura_connected=true`, `/?whoop=connected#/settings`, `?strava_error=…`, and so on), and nothing read it. Now, once the account has loaded, the app opens Settings → Integrations with one status line:
  - "Oura connected. Connecting also syncs your last 14 days; the result is below."
  - "Oura didn't connect: access wasn't granted. You can try again below."
- It then replaces the address, so a reload doesn't replay the line. Unknown error codes show only as a short code, so a crafted link can't put a sentence of its choosing on screen. A bare `/settings` (old links) opens Integrations too.
- Integrations saves the confirmed connection quietly (new `onPatch`). It used the full Save path before, which closes Settings and toasts, so opening Integrations after a new connection shut the screen as soon as the status loaded. Because the flag is saved straight away, Recovery's sample clears without a separate trip to Settings.
- That save is a server-side merge (`patchSettings`), never the device's whole settings object, and it gives up if it can't read the stored profile first. The review showed why: after a failed launch read, the device copy is the defaults, and saving it wipes the profile.
- Strava and Google forward the provider's own message when the sign-in fails ("Bad Request", `strava_token_401`). Those now read as "the sign-in couldn't be completed" instead of a code.
- Recovery's "Open Settings" and "Reconnect Oura" were `href="/settings"` links: a full reload that came back up on Today. They're in-app buttons now.
- Opening Settings on a later section scrolls the phone's section tab row so that tab is in view, and the active tab carries `aria-current`.

### Privacy policy and terms (`public/legal/`)
- The AI Coach processor is now Ollama Cloud, not Anthropic, in the privacy policy's sharing list (§5) and the terms' third-party list (§8). `coach.js` sends coach context to `https://ollama.com/api/chat`.
- With `log-event` reachable, the policy now discloses first-party product events (the diagnostics list, plus a retention line).
- "Last updated" is now October 22, 2026 on both pages and the legal index.
- **Review the wording before you deploy.** These are legal pages and I'm not a lawyer.

### Quick wins
- The two date-window tests pin their clock (`coachingCalibrationV18_5.test.js`, `ouraIsolation.test.js`). `npm test` runs every batch again.
- Export Full Backup and Export CSV page the whole history from the server and lay the in-memory data over it, so unsaved local edits win. Before, they exported the in-memory map: the 180-day boot window plus whatever the background history load had merged. If the server can't be reached, the export still happens, and the export screen (or the "Shared" toast) says it only has what's on this device.
- Not done: deleting the unused modules (`appShellStyle.js`, `useSwipe.js`, `formCheck/barPathTracker.js`). Nothing breaks with them in place, and it isn't front-door work.

## Data / AI line
- No migrations and no schema changes. Settings gain no new keys.
- `data.js` gains `loadSettingsChecked`, `loadProgramChecked`, `loadAllEntriesChecked` and `patchSettings`. Every existing function answers exactly as before.
- Nothing here touches what the Coach sees. Strava data stays out of AI Coach payloads.

## Validation
- **`frontDoorV19_4.test.jsx` (20) drives the real App.** Only Supabase, the data layer's network calls and `fetch` are faked; App, Tutorial, TodayTab, SessionMode, the detector and Settings are the shipped code. It covers:
  - A new account signs in, finishes setup and banks its first set.
  - After a manual setup, Fuel and Recovery are live.
  - A wearable setup's Recovery sample opens Integrations.
  - A failed setup save keeps the wizard open, and Finish retries.
  - An OAuth return lands on Integrations with the status line and a clean address, and an ordinary launch stays where it is.
  - A confirmed connection is saved quietly, and Settings stays open.
  - With nothing cached, a failed read shows the retry panel: no setup, no samples, no writes. Try again then loads the account and handles the waiting OAuth return.
  - An account with no profile row gets the panel, never setup.
  - After logout → login, neither the first account's settings nor its unsent day reach the second account.
  - Behind the retry panel, a queued day neither flushes nor reaches the cache, even when the device comes back online, and a failed Try again shows the panel again.
  - While the account loads, Profile waits and Settings can't open.
  - A sign-out from another tab with Settings open doesn't reopen Settings on defaults, and one with the export or import screen open doesn't carry either into the next sign-in.
  - A failed program read with nothing cached shows the panel, and Try again brings back the athlete's own plan.
  - An offline launch keeps the cached settings and program.
  - A cached launch whose saved theme differs from the phone's still revalidates; the server's theme wins over the cached paint.
  - An export that couldn't reach the server says so on the export screen.
- **The tests fail on the bugs they pin:**
  - The four setup walks fail on the v19.3 detector.
  - Each review fix's test fails when that fix is reverted. That covers theme back in the launch dependencies, no `onPatch`, failed reads treated as answers, and the quiet save writing the whole settings object. It also covers no queue reset on logout, the stale theme comparison, no export note, a missing row treated as a new account, and a failed read falling back to memory. The later rounds add the queue flush gated on `loaded`, ungated cache writes, an ungated Profile, no reset on any sign-out (Settings, export, import), and a failed program read showing the default plan.
- **`dataReadFailures.test.js` (8):** the checked loaders tell a good read, a missing row and a failed read apart, and `patchSettings` aborts rather than writing blind.
- **`pushResync.test.js` (2):** a device's subscription is sent once per launch, only with permission, and without preference fields.
- **`oauthReturn.test.js` (18):** every callback's return URL, the error wording (including Strava's and Google's pass-through messages), the crafted-link guard and the address clean-up. It also checks that the four callbacks still redirect where the parser expects.
- **`netlify/tests/api-routes.test.js` (5):** covered above.
- **Updated suites:**
  - `settingsIntegrationsParity` +4: landing, quiet patch, Save fallback, and an unknown section opening Macros.
  - `dayZeroEdition` +3, plus one rewritten (its `macroTargets` lines pinned the bug).
  - `sundayEdition` +1, and its fixtures use `goals`.
- **`npm test` runs all 21 batches:** 166 files · 1,913 tests passing. In v19.3 it stopped at batch 5.
- **`npm run quality:gate` is green end to end:**
  - Tests, plus ESLint at 0 errors · 31 warnings. That's one fewer than v19.3: logout now reassigns `saveTimers.current`, so the linter stops treating it as a DOM ref.
  - Production and demo builds, the dist secret scan, and the deploy artifact. The production build was also scanned on its own: clean.
  - Entry chunk 457.95 kB / 145.42 kB gzip (v19.3: 450.65 / 143.19). `push.js` is its own 2.75 kB chunk, loaded only on devices with notification permission.
  - `sync:version` stamped `public/sw.js` → `ovt-shell-v19.4.0`.
- **Visual checks in headless Chromium at 390px:**
  - Settings → Integrations opened from the Oura success, Oura error and Strava return URLs: the status line fits, with no horizontal scroll and no page errors. That pass added scrolling the section tab row so INTEGRATIONS is in view; it sat off-screen to the right.
  - The retry panel, using a build whose every database read fails, on Today and on Profile (with Log out): no wizard, no samples, no overflow.
  - The demo build clicked through every tab, then Profile → Settings → Integrations → Close, with no page or console errors.

## Known nuances
- **Exports on iPhone:** the share sheet needs a recent tap, and the history fetch now sits between the tap and the share. If the sheet doesn't appear, the download and the copy screen still do.
- **Push:** a subscribe now really writes to `push_subscriptions`. If that table doesn't exist (`supabase/migration_add_push_subscriptions.sql`, plus `migrations/V17_3_courier.sql` for The Courier), enabling notifications will report a failure instead of whatever the unrouted request got back before.
- **Funnel:** the `events` table is optional (`migrations/V17_0_events.sql`), and the endpoint returns 200 without it. Run that migration to start collecting. `dayzero_seen_today` and `dayzero_seen_fuel` will now be rare (accounts that haven't finished setup). `dayzero_seen_recovery` now means a wearable setup that hasn't connected yet.
- **Other settings saves still write the whole object.** Settings → Save, theme changes, coach preferences and Program Builder all save the device's entire settings object. Two devices changing settings at once can therefore undo each other (the last write wins). They can no longer run off defaults: Profile and Settings stay closed until the account has loaded. Setup and the connection flag already merge server-side. Next: route the rest through `patchSettings`.
- **Caches written by v19.3 after a failed read already hold default settings,** and they count as the account's own cache. That only matters if the first v19.4 launch's read also fails. Once any read succeeds, the cache is rewritten correctly.
- **A failed entries read is still silent** (`loadRecentEntries` answers `{}`). With nothing cached, the first edit to a day sends that whole day, which can overwrite the server's copy. This was already the case. Next: a checked entries loader, like the settings and program ones.
- **Behind the retry panel, Coach is still reachable** and answers from default settings. It doesn't write anything.
- **OAuth callbacks with a missing or expired session** still answer raw JSON (for example `oura-auth.js` around line 723) instead of coming back to the app. This was already the case.
- **For the legal review:** Form Check sends video to the `FORM_CHECK_API_BASE` service, which the privacy policy's sharing list (§5) doesn't name. This was already the case.

## Deploy
- Deploy as usual. The function changes are the three `config.path` lines, and there are no migrations or env vars.
- After deploying, `curl -i -X POST https://0vertrained.netlify.app/api/log-event` should return the function's JSON 401 (`Missing authorization token`), not HTML.
