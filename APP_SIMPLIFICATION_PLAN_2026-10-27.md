# Simplification plan — 2026-10-27 (v19.5.0)

**Status (v19.6.0):** Tier 1 shipped, plus the Recovery consolidation from Tier 2 and everything Hyrox removed. Two Tier 1 items stayed: the HRV toggle (needs a settings write from Recovery) and the Google Health function (a deploy change). The rest of Tier 2 and Tier 3 are open. See `V19_6_0_LESS_ON_EVERY_SCREEN_RELEASE.md`.

**Bottom line:** the clutter isn't layout, it's that the app gives the same advice from several places at once. About twenty modules generate guidance (`decisionEngine`, `todayDecision`, `physiqueOS`, `verdictResolver`, `oura/insights`, `oura/alerts`, `weeklyCoachReview`, `coachingOutcomeLoop`, `sundayEdition`, `periodizationPlanner`, `nutritionCoach`, `nutritionAutopilot`, `fatigueManagement`, `progressSummary`, `adaptiveTraining`, …), and roughly a dozen of them have their own panel. Recovery alone shows four readings of one morning. On top of that, a handful of things built for you or for development are shipping to every user. The plan below cuts in three tiers; nothing in Tier 1 or 2 deletes data or a logger.

Method: every screen of the v19.5.0 demo build at 390px, measured (height, buttons, inputs, section labels) and read, plus the module list. Numbers are from that run.

## What the screens look like today

| Screen | Length | Controls | What's on it |
|---|---|---|---|
| Today (collapsed) | 1 screen | 14 buttons | Command card (verdict + Start session + Why this plan), metric strip, Fuel row, Day progress, Workout, Recovery line, Daily log. Fine. |
| **Recovery** | **2.7 screens** | 20 buttons, **45 section labels** | Check-in · verdict ("Fresh 97 · Green light") · "What does this mean" · Signals ("READY, 1 alert") · Mixed signal day ("CAUTION · HRV") · Wearable readiness check · Data trust · Coach interpretation ("Biometrics look stable") · Readiness 97 "Push" with method + 7-day trend · Technical details (Intelligence · Ledger · Quality · Load) |
| Fuel | 1.2 screens | 18 buttons | LOG / FACTOR / RECIPES tabs · Still needed · Next fuel action · Alternatives · Water · Next meal (Plan ▸) · Fuel ↔ Recovery · manual ledger |
| Progress → Overview | 1 screen | — | Limiting factors + three disclosures. Fine (fixed in V18.1). |
| **Progress → Coach** | 2.2 screens | 18 buttons | **8 panels:** Weekly coaching review (approve / modify / hold) · Recommendation lifecycle · Monthly physique review + photo protocol · Coaching inbox · Plan versions · Goal projection · Phase management · Coach controls (clinician guardrails) |
| Progress → Program | 1.6 screens | — | Block (4-week planner) · **Race block** (V7 Hyrox ledger, "Set race target") · Current week · Suggested action · 4-week block list |
| Progress → History | **11 screens** | — | Every logged day, no paging |
| **Profile hub** | **2.4 screens** | **19 buttons + 6 inputs** | Training plan (4) · Form check (1) · Account + data (Settings, 2 exports, 2 imports, Log out, Copy beta note) · App (Theme → Settings, Notifications "unavailable", **Coach memory form inline**: 4 selects, a textarea, 3 buttons) · Social sharing · View / share demo page |
| Settings | 8 sections | — | Macros · Supplements · Dietary (5 checkboxes) · Training (2 toggles) · Theme (2 options + "More themes coming soon") · Integrations (Fitbit "Coming soon", Strava, Oura, HRV algorithm toggle, Whoop, Social sharing again) · Account · About ("Fig. D · Load diagnostics") |

Three navigation facts behind the clutter:
- **The training plan is managed in two places.** Profile → Training plan (Generate · Edit · Switch · Race plan) and Progress → Program (Block · Race block · Week).
- **The week is reviewed in two places.** The Sunday Edition overlay (Recovery, Sunday 5 pm → Monday) and Progress → Coach → Weekly coaching review.
- **Preferences are in two places.** Profile → App (Coach memory, Notifications, Social) and Settings (8 sections).

## Tier 1 — Remove what isn't for users

Low risk. Each is a hide or a delete with tests updated.

1. **Fuel → FACTOR tab.** `factorCutPlan.js` is your 12-day prepared-meal block ("Rami's 12-day prepared-meal block"). Every user gets a tab for it. Remove the tab; keep the module out of the bundle.
2. **Progress → Program → Race block.** The V7 `raceBlock.js` / `RaceBlockSection.jsx` (countdown + Hyrox station ledger) predates the v19.3 race plan and is the source of the two-week-counters bug (review #11). The v19.3 plan already drives the race block's countdown; the "Set race target" form is a second, unconnected race. Remove the section; the Hyrox station ledger can move under Progress → History if you still want it.
3. **Settings → About → "Fig. D · Load diagnostics".** `perf.js` instrumentation with a Clear button, on a user screen. Keep it behind `?perf` or drop it.
4. **"Coming soon" and sprint copy.** The Fitbit / Google Health card (the function is also still deployed, review "Stop or cut"), "// More themes coming soon." in Theme, and "algorithm blending arrives next sprint" in the Whoop card. Users read these as unfinished work.
5. **Developer utilities off the Profile hub.** "Copy beta feedback note" and "View / share demo page" move to the bottom of About.
6. **Social sharing in one place.** It's in Profile → App and in Settings → Integrations. Keep Settings.
7. **HRV calculation toggle** (Our Algorithm / Oura Balance) in Integrations: move into Recovery → Technical details, where the number it changes lives.

Effect: Fuel loses a tab, Program loses a section, Profile loses 3 items, Settings → Integrations loses two cards and a toggle.

## Tier 2 — One verdict per tab

This is where the "cluttered" feeling comes from. Each tab keeps one answer visible and moves the evidence behind one disclosure.

### Recovery (2.7 screens → about 1.2)
Today's order: check-in → verdict → what-does-this-mean → Signals → Mixed signal day → Wearable readiness check → Data trust → Coach interpretation → Readiness score + method + trend → Technical details. Four of those say "you're ready" in different words, and one says "caution".

Keep, in order: **check-in → verdict card** (score, state, one sentence, what changed, the readiness method behind the existing "Show how readiness is scored") **→ Data trust → Technical details.** Fold Signals, Mixed signal day, Wearable readiness check, Coach interpretation and the 7-day trend into Technical details as its first four tabs. The verdict resolver already takes the alerts and the sleep debt into account (the V13 P0 fix), so nothing is lost; it's shown once.

### Progress → Coach (8 panels → 3)
Keep **Weekly coaching review** (approve / modify / hold), **Goal projection**, and fold **Phase management** into the review's verdict line. Hide Recommendation lifecycle, Coaching inbox, Plan versions, Monthly photo protocol and Clinician guardrails until the AI Coach is open to users; they're the V18.5–19.0 coaching system's bookkeeping, and the Coach itself is gated to your account (`coachEnabled.js`). If you'd rather keep them, put them under one "Coaching system" disclosure at the bottom.

### One weekly review
The Sunday Edition and the Weekly coaching review both review the week with one prescription. Keep one. The Sunday Edition is the better product (it composes everything and is already on the masthead on Sunday); the coaching review's approve / modify / hold can become its last line.

### Progress → Program
With the old Race block gone, the Block follows the race plan when one is active (its weeks, phases and deload), and is the only planner otherwise. Then **move the Program sub-tab under Profile → Training plan**, so the plan has one home: Generate · Edit · Switch · Race plan · Block. Progress becomes Overview · Coach · Form · History.

### Fuel
Three ways to log the next thing: "Next fuel action", the Alternatives quick-adds, and "Next meal · Plan ▸". Keep the hero action and quick-adds on LOG; the meal plan lives under RECIPES. The "Fuel ↔ Recovery" section is a one-liner that belongs in Recovery's Technical details.

### Today
Already the cleanest tab. Two small cuts: the "Fuel → Open the full meal and macro plan" row (Fuel is one tap away, and the metric strip already shows protein and calories) and the "Day progress 10% ›" row, which duplicates the strip.

### Progress → History
Page it: last 14 days, then "Show 30 more". 11 screens today.

## Tier 3 — Fewer homes for settings

- **Settings: 8 sections → 6.** Theme (2 options), Training (2 toggles) and Dietary (5 checkboxes) become one **Preferences** section. Macros · Supplements · Preferences · Integrations · Account · About.
- **Profile hub: 19 buttons + 6 inputs → about 10 buttons.** Training plan (now with Block) · Form check · Data (export / import) · Settings · Log out. Coach memory becomes a Settings section (or goes with the Coach gate), Notifications and Social are already in Settings.
- **Navigation stays:** TODAY · RECOVERY · + · FUEL · PROGRESS, and the Profile button. The earlier audits were right to keep the dock.

## What not to touch
- The whitepaper identity: masthead, edition number, hairlines, mono labels, serif verdicts.
- Data trust and the raw-value ledgers. They're the trust feature; they just shouldn't compete with the verdict for the first screen.
- The loggers (Session Mode, quick edit, cardio runner, Fuel search, check-in) and the race plan. Nothing above changes a write path.

## Size
- Tier 1: a day. Mostly deletions; the risk is tests that pin the removed surfaces (`raceBlock`, `factorCutPlan`, perf, the Integrations copy).
- Tier 2: two to three days. Recovery and Progress → Coach are reorderings of existing components; the Program move is the only real restructuring. Each tab gets a before/after screenshot check in the demo build.
- Tier 3: a day.

Suggested order: Tier 1, then Recovery, then Progress → Coach + the weekly review, then the Program move, then Tier 3. Each step ships on its own.
