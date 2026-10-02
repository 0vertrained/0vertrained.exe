# V13.2 — Landing Front Matter (Google Verification + Redesign Release)

**Date:** 2026-07-10 · **Scope:** logged-out landing/auth page, `index.html` meta, privacy policy addendum, theme bootstrap. No scoring, storage, or write-path changes.
**Gate:** 1,245 tests passing (7 new) · lint clean (0 errors) · production + demo builds green · secret scan clean · entry chunk +5.4 kB raw / ~+2 kB gzip (the landing module itself; it is first paint for logged-out users).

The logged-out root is the homepage URL that goes on the Google OAuth consent
screen, so it must clear Google's API-verification homepage checklist before
the Fitbit-by-Google integration is submitted. This release makes the page
compliant and, in the same pass, completes the V13 metaphor: the landing is
the paper's **front matter** — masthead, title, Abstract, specimen figure,
method, data-sources table, disclosures, colophon. See
`LANDING_REDESIGN_PLAN.md` context for the full rationale.

---

## 1 · Google verification compliance

- **Limited Use disclosure** added in three places, kept in lockstep: the
  landing's Fig. 4 footnote, the privacy policy's "Google API data" item
  (`public/legal/privacy-policy.html`), and the no-JS fallback in
  `index.html`. All three link
  `https://developers.google.com/terms/api-services-user-data-policy`. Its
  absence is the single most common verification rejection.
- **Fig. 4 · Google user data** (`#google-data`, deep-linkable for reviewer
  notes): a ruled disclosure figure with four rows — *We access* (the Fitbit
  data types, a strict subset of the privacy policy's enumeration), *Only to*
  (user-facing features only, AI Coach opt-in called out), *Never* (no
  selling, no ads, no generalized AI/ML training), *Your control*
  (optionality, Settings → Integrations disconnect deletes tokens + imported
  data, Google Account revocation path).
- **Privacy + Terms links now appear twice** — masthead and the new colophon
  footer — so any screenshot of the page bottom satisfies the "easily
  accessible privacy link" check. The colophon also renders the consent-screen
  support email once `SUPPORT_EMAIL` in `src/landing/LandingPage.jsx` is set
  (empty by default so nothing fake ships) and carries "Not medical advice."
- **Functionality description** is now an explicit, labeled **Abstract** —
  the app's full functionality including the scope-consuming features
  (wearable import, recovery/readiness, opt-in AI Coach and Form Check).
- **`index.html`:** meta description mirroring the Abstract, `og:` tags, and
  a `<noscript>` fallback inside `#root` (app description + Limited Use
  sentence + privacy/terms links) so the homepage is never contentless to a
  no-JS crawler or reviewer configuration. **The `google-site-verification`
  meta tag is unchanged, byte-for-byte, and now annotated DO NOT REMOVE** —
  domain ownership verification depends on it.
- **`src/__tests__/landingCompliance.test.jsx`** (7 tests) locks all of the
  above: the disclosure string + policy link on the rendered page, the
  Abstract, ≥2 privacy/terms links, the four Fig. 4 rows + `#google-data`
  anchor, the privacy-policy sentence, the verbatim site-verification tag,
  and the noscript privacy link. A refactor that drops any of these fails CI
  before it fails verification.

**Still on the human checklist at submission time** (see
`LANDING_REDESIGN_PLAN.md` §8): set `SUPPORT_EMAIL`, remove the Fig. 3
"Coming soon" tag in the PR that flips the Google Health feature flag,
consent-screen fields matching the page (app name, homepage root URL —
static, no redirect — privacy URL, support email), Search Console property
confirmed, scopes enumerated, demo video.

## 2 · Front-matter rebuild (`src/landing/`)

- **`LandingPage.jsx`** replaces `PublicAppSummary`: masthead (wordmark +
  Demo / Privacy / Terms / **Sign in ↓** jump), title block + Abstract, and
  numbered figures — Fig. 1 the live specimen, Fig. 2 Method
  (01 Log · 02 Reconcile · 03 Decide), Fig. 3 Data sources (Manual first;
  "Fitbit by Google" row wears a `ProvisionalTag` "Coming soon"), Fig. 4
  disclosures, colophon. The marketing-splash dark panel — the only surface
  that fought the theme system (`color-mix()`, forced-dark) — is retired.
- **`ReadinessSpecimen.jsx`**: the readiness card, band helpers, scenario
  set, and auto-cycling specimen extracted from `DemoPage` so the landing's
  Fig. 1 and the demo hero render one and the same component
  (`computeReadinessIndex` was already in the entry chunk via TodayTab, so
  the live specimen costs nothing). `DemoPage` now imports
  `ReadinessCard` / `ReadinessSpecimen` / `bandFor` / `LABEL` and keeps only
  its demo-specific `FlowField` coupling.
- **`AuthScreen.jsx`** shrinks to composition + auth logic (signup cap,
  recovery phrase, `onAuthed` — behavior unchanged). Layout uses the shared
  `useIsDesktop()` 1024px contract: desktop `1.55fr / 1fr` grid with a sticky
  auth rail, single column on mobile (sticky off). The submit button is now
  the card's one filled primary (inverted ink), per the V6 interaction-verb
  system.

## 3 · Theme + shell fixes

- **Logged-out theme follows `prefers-color-scheme`** (`whitepaperDark` on
  dark systems), matching the static `/legal` pages; a signed-in user's saved
  theme still overrides on load.
- **Document background/colour now sync with the active theme** alongside the
  existing `--ovt-focus` effect — previously `index.css`'s static paper values
  framed the dark themes with light gutters outside the content width.
- **`theme-color`** meta updated from the retired terminal `#16181c` to the
  Whitepaper stocks (`#FAF9F6`, dark `#141311` via media query).
- **`DemoPage` "Request early access"** buttons no longer point at the
  `REPLACE-WITH-YOUR-SIGNUP-FORM` placeholder: `SIGNUP_URL = "#signin"`,
  which closes the demo overlay via App's hashchange listener and lands on
  the auth card.

## 4 · Settings → Integrations copy

- The Google Health / Fitbit "coming soon" note dropped its implementation
  talk (verification status, staged code, OAuth state) for one user-facing
  line: *"Coming soon — connect your Google account to bring Fitbit sleep,
  recovery, and activity data into the app."* The redundant dashed status box
  went with it (note + disabled button already say it).
- The "Provider standard" box was removed entirely — connected-account
  architecture is a `PROVIDER_INTEGRATION_STANDARD.md` concern, not a
  settings-page concern, and its chips duplicated each provider's own section.

## 5 · Strava: plan added

`STRAVA_INTEGRATION_PLAN.md` — design for taking Strava from "imported but
consumed nowhere" (the `activities` table currently has zero client readers)
to: Phase 1 cardio-ledger auto-fill + `stravaLoadForDay` in the load bridge
with manual-canonical merge rules, Whoop dedupe, and hard AI-Coach exclusion
enforcement at the payload builders; Phase 2 mileage/pace figures, race-block
running volume, and correlation-explorer variables; Phase 3 lazy HR streams
(true TRIMP + 80/20 polarization figure) and the webhook that also satisfies
Strava's deauthorization-purge requirement.
